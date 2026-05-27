/**
 * Cloudflare Container-backed Durable Object for ffmpeg video processing.
 *
 * `FFmpegContainer` wraps a Docker container that runs a Python/Flask HTTP
 * server exposing three ffmpeg endpoints: `/transcode`, `/extract-audio`, and
 * `/grayscale`. The `VideoProcessingWorkflow` calls these endpoints via the
 * DO networking layer, passing presigned R2 URLs so the container can
 * download input and upload output without streaming through the Worker.
 *
 * ## Wrangler config requirements (present in wrangler.jsonc.tpl)
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
 * The container listens on port 8080 (Flask default). `sleepAfter = 60`
 * means the container shuts down automatically after 60 seconds with no
 * incoming requests, keeping idle costs low while still being warm enough
 * for the typical multi-step workflow that sequences calls within seconds.
 *
 * @example
 * ```ts
 * // Obtain a stub for a specific video's container instance
 * const stub = env.FFMPEG_CONTAINER.get(
 *   env.FFMPEG_CONTAINER.idFromName(videoId)
 * );
 * // Wait for the container to be ready, then call an endpoint
 * await stub.startAndWaitForPorts();
 * const res = await stub.fetch(
 *   new Request("http://container/health")
 * );
 * ```
 */
export class FFmpegContainer extends Container<Env> {
  /**
   * Port that the Flask HTTP server inside the container listens on.
   * Must match the `EXPOSE` directive in `container/Dockerfile` and the
   * `app.run(port=8080)` call in `container/server.py`.
   */
  override defaultPort = 8080;

  /**
   * Number of seconds of inactivity (no HTTP requests) after which the
   * container is automatically stopped.
   *
   * 60 seconds provides a balance between cost efficiency and warm-start
   * availability. In a typical pipeline the workflow issues three back-to-back
   * container calls (transcode → extract-audio → grayscale) within seconds,
   * so the container stays warm across all steps and only idles out once the
   * workflow has finished.
   */
  override sleepAfter = 60;
}
