/**
 * Cloudflare Container-backed Durable Object for ffmpeg video processing.
 *
 * `FFmpegContainer` wraps a Docker container that runs a Python/Flask HTTP
 * server exposing three ffmpeg endpoints: `/transcode`, `/extract-audio`, and
 * `/grayscale`. The `VideoProcessingWorkflow` calls these endpoints via the
 * DO networking layer, passing presigned R2 URLs so the container can
 * download input and upload output without streaming through the Worker.
 *
 * ## Request flow
 *
 * Each call from the Workflow passes through `fetch()` before reaching the
 * container process:
 *
 *  1. `startAndWaitForPorts()` — ensures port 8080 is accepting TCP connections.
 *     Without this, a request that arrives during a cold start (1–3 s) may hit
 *     the container before gunicorn is ready and receive an HTML error page
 *     instead of JSON, causing the Workflow step to throw a `SyntaxError`.
 *  2. `/health` check — verifies Flask is responding with `application/json`
 *     and `{"ok": true}`. This catches the edge case where the socket is open
 *     but gunicorn workers have not yet finished loading.
 *  3. `containerFetch(request)` — proxies the actual request to the container.
 *
 * ## Wrangler config requirements (present in wrangler.jsonc.tpl)
 * - `containers[].class_name` = `"FFmpegContainer"`
 * - `durable_objects.bindings[].name` = `"FFMPEG_CONTAINER"`
 * - `migrations[].new_sqlite_classes` includes `"FFmpegContainer"`
 *
 * @module container
 */

import type { StopParams } from "@cloudflare/containers";
import { Container } from "@cloudflare/containers";

/**
 * Durable Object that manages a single ffmpeg Docker container instance.
 *
 * Each video being processed gets its own named instance so multiple videos
 * can be transcoded in parallel without serialisation:
 *
 * ```ts
 * const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
 * // The fetch() override handles startup and readiness automatically.
 * const resp = await container.fetch("http://container/transcode", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ input_url, output_url }),
 * });
 * ```
 *
 * The container listens on port 8080 (gunicorn default).  `sleepAfter = "5m"`
 * means the container shuts down automatically after 5 minutes with no
 * incoming requests, keeping idle costs low while giving the Workflow enough
 * time to issue all three sequential container calls (transcode → extract-audio
 * → grayscale) without triggering a second cold start mid-pipeline.
 *
 * `pingEndpoint = "localhost/health"` directs the Container runtime to use the
 * Flask `/health` route (which returns `{"ok": true}`) rather than the default
 * `localhost/ping` stub when polling for readiness during startup.
 *
 * @example
 * ```ts
 * // Obtain a stub for a specific video's container and send a request.
 * // The fetch() override ensures the container is ready before forwarding.
 * const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
 * const resp = await container.fetch("http://container/grayscale", {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ input_url, output_url }),
 * });
 * ```
 */
export class FFmpegContainer extends Container<Env> {
  /**
   * Port that the Flask/gunicorn HTTP server inside the container listens on.
   * Must match the `EXPOSE` directive in `container/Dockerfile` and the
   * `--bind 0.0.0.0:8080` argument passed to gunicorn.
   */
  override defaultPort = 8080;

  /**
   * How long to keep the container alive after the last request before
   * shutting it down automatically.
   *
   * `"5m"` (5 minutes) ensures the container stays warm across all three
   * sequential Workflow steps (transcode → extract-audio → grayscale) even
   * if there are delays between steps.  Using a string duration is preferred
   * over a bare number of seconds for readability.
   */
  override sleepAfter = "5m";

  /**
   * HTTP endpoint the Container runtime polls to verify readiness during
   * startup.  Overrides the default `"ping"` stub to use the Flask `/health`
   * route, which returns `{"ok": true}` once gunicorn workers are ready.
   */
  override pingEndpoint = "localhost/health";

  // ---------------------------------------------------------------------------
  // Lifecycle hooks
  // ---------------------------------------------------------------------------

  /**
   * Called by the Container runtime after the container process has started
   * and the port is accepting connections.
   *
   * Logs a confirmation message so the wrangler console shows a clear marker
   * for when the container transitions from starting to healthy.
   */
  override onStart(): void {
    console.log("[FFmpegContainer] container started — gunicorn/Flask is up");
  }

  /**
   * Called by the Container runtime after the container process exits.
   *
   * Logs the exit code and reason so failures are visible in wrangler logs
   * without requiring a separate dashboard query.
   *
   * @param params - Exit information from the Container runtime.
   * @param params.exitCode - The exit code the container process returned.
   *   `0` is a clean shutdown; non-zero indicates an error.
   * @param params.reason - Why the container stopped: `"exit"` (process
   *   exited on its own) or `"runtime_signal"` (the runtime sent a signal).
   */
  override onStop({ exitCode, reason }: StopParams): void {
    if (exitCode === 0) {
      console.log(
        `[FFmpegContainer] container stopped gracefully — reason: ${reason}`,
      );
    } else {
      console.error(
        `[FFmpegContainer] container stopped with error — exit code: ${exitCode}, reason: ${reason}`,
      );
    }
  }

  /**
   * Called by the Container runtime when the `sleepAfter` timer expires with
   * no incoming requests.
   *
   * Logs the current container state before stopping so idle shutdowns are
   * distinguishable from error-driven stops in wrangler logs.
   *
   * Calls `this.stop()` — this is required.  If `stop()` is not called, the
   * timer renews and the hook fires again on every subsequent expiry.
   */
  override async onActivityExpired(): Promise<void> {
    const state = await this.getState();
    console.log(
      `[FFmpegContainer] idle timeout (sleepAfter=${this.sleepAfter}) — stopping. state: ${state.status}`,
    );
    await this.stop();
  }

  /**
   * Called by the Container runtime when startup or port-check errors occur.
   *
   * Logs the error with full detail before re-throwing.  Re-throwing is
   * required so the `startAndWaitForPorts()` call in `fetch()` propagates
   * the error to the Workflow step, which can then retry or mark the video
   * as failed.
   *
   * @param error - The error thrown during startup or port readiness checks.
   * @returns Never — always throws.
   */
  override onError(error: unknown): unknown {
    console.error("[FFmpegContainer] container startup/port error:", error);
    throw error;
  }

  // ---------------------------------------------------------------------------
  // Request handling
  // ---------------------------------------------------------------------------

  /**
   * Intercepts every request from the Workflow before proxying it to the
   * container process.
   *
   * ## Steps
   *
   * 1. **Log** the incoming method and path for visibility in wrangler logs.
   * 2. **`startAndWaitForPorts()`** — blocks until port 8080 is accepting TCP
   *    connections (up to 30 s).  This is the primary guard against the cold-start
   *    HTML error: the default `fetch()` starts the container but does not wait
   *    for readiness before forwarding, so a request that arrives during the 1–3 s
   *    boot window can receive a proxy error page instead of JSON.
   * 3. **Health check** — calls `GET /health` and verifies HTTP 200 +
   *    `Content-Type: application/json`.  This is a secondary guard that catches
   *    the edge case where the TCP socket is open but gunicorn workers have not
   *    yet finished initialising.  The full response body is logged regardless
   *    of outcome.
   * 4. **Proxy** — forwards the original request via `containerFetch()` (not
   *    `this.fetch()`, which would recurse infinitely).  Logs the response status
   *    and content-type.
   *
   * @param request - The incoming request from the Workflow DO stub call.
   * @returns The response from the container, suitable for the Workflow to
   *   call `.json()` on.
   * @throws If `startAndWaitForPorts()` times out, the health check fails, or
   *   the container returns an unexpected response.  The Workflow's retry logic
   *   will re-invoke the step.
   */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    console.log(`[FFmpegContainer] → ${request.method} ${url.pathname}`);

    // Step 1: wait for port 8080 to accept connections.
    // Timeout is 30 s — generous for the gunicorn + Flask startup time.
    console.log("[FFmpegContainer] waiting for port 8080 to be ready…");
    await this.startAndWaitForPorts();
    console.log("[FFmpegContainer] port 8080 ready");

    // Step 2: HTTP-level health check.
    // Verifies Flask is serving JSON before we send the actual work request.
    // Reading the body as text first avoids "body already consumed" errors.
    const healthResp = await this.containerFetch("http://localhost/health");
    const healthStatus = healthResp.status;
    const healthContentType = healthResp.headers.get("content-type") ?? "";
    const healthBody = await healthResp.text();
    console.log(
      `[FFmpegContainer] /health → HTTP ${healthStatus}  Content-Type: ${healthContentType}  body: ${healthBody.slice(0, 300)}`,
    );

    if (
      healthStatus !== 200 ||
      !healthContentType.includes("application/json")
    ) {
      throw new Error(
        `Container health check failed: HTTP ${healthStatus}, Content-Type: ${healthContentType}`,
      );
    }

    // Step 3: proxy the actual request.
    // containerFetch (not this.fetch) avoids infinite recursion.
    console.log(
      `[FFmpegContainer] forwarding ${request.method} ${url.pathname} to container`,
    );
    const resp = await this.containerFetch(request);
    console.log(
      `[FFmpegContainer] ← HTTP ${resp.status}  Content-Type: ${resp.headers.get("content-type") ?? ""}`,
    );
    return resp;
  }
}
