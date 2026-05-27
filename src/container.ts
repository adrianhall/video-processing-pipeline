/**
 * Cloudflare Container-backed Durable Object for ffmpeg video processing.
 *
 * `FFmpegContainer` wraps a Docker container that runs a Python/Flask HTTP
 * server exposing three ffmpeg endpoints: `/transcode`, `/extract-audio`, and
 * `/grayscale`. The `VideoProcessingWorkflow` calls these endpoints by
 * generating presigned R2 URLs and POSTing them to the container.
 *
 * This file is a **stub** — only the class declaration and the `defaultPort`
 * are set here so Wrangler can validate the Worker entry point. The full
 * implementation (Flask server, ffmpeg logic, sleepAfter, health checks) will
 * be added in the container implementation issue.
 *
 * ## Wrangler config requirements (already present in wrangler.jsonc.tpl)
 * - `containers[].class_name` = `"FFmpegContainer"`
 * - `durable_objects.bindings[].name` = `"FFMPEG_CONTAINER"`
 * - `migrations[].new_sqlite_classes` includes `"FFmpegContainer"`
 *
 * @module container
 */

import { Container } from "@cloudflare/containers";

/**
 * Durable Object that manages a single ffmpeg Docker container instance.
 *
 * Each video being processed gets its own named instance so multiple videos
 * can be transcoded in parallel without serialisation:
 *
 * ```ts
 * const stub = env.FFMPEG_CONTAINER.get(
 *   env.FFMPEG_CONTAINER.idFromName(videoId)
 * );
 * await stub.fetch(new Request("http://container/transcode", { ... }));
 * ```
 *
 * The container listens on port 8080 (Flask default). The `VideoProcessing-
 * Workflow` reaches it via `stub.fetch()` which Cloudflare routes through the
 * DO networking layer to the running container.
 *
 * @example
 * ```ts
 * // Obtain a stub for a specific video's container instance
 * const stub = env.FFMPEG_CONTAINER.get(
 *   env.FFMPEG_CONTAINER.idFromName(videoId)
 * );
 * const res = await stub.fetch(
 *   new Request("http://container/health")
 * );
 * ```
 */
export class FFmpegContainer extends Container<Env> {
  /**
   * Port that the Flask HTTP server inside the container listens on.
   * Must match the `EXPOSE` directive in `container/Dockerfile` and the
   * Flask `app.run(port=…)` call in `container/server.py`.
   */
  override defaultPort = 8080;
}
