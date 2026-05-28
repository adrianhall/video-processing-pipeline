/**
 * Cloudflare Workflow that orchestrates the multi-step video processing pipeline.
 *
 * ## What this file does
 *
 * `VideoProcessingWorkflow` is the **star of this project**. It sequences five
 * independently-retriable steps that take a raw uploaded video all the way to a
 * grayscale MP4 stored in R2 and ready for browser playback:
 *
 *  1. **Register** — flip the D1 status to `"processing"` so the UI updates immediately.
 *  2. **Transcode** — normalise the upload to MP4 / H.264 + AAC via the ffmpeg container.
 *     If the source file is already MP4, the file is copied directly in R2 (no container call).
 *  3. **Extract audio** — pull the audio track to a standalone MP3 file in R2.
 *     If the input has no audio stream this step is a silent no-op.
 *  4. **Grayscale** — re-encode the MP4 with `format=gray` while keeping the audio.
 *  5. **Finalize** — mark the D1 record `"complete"` and delete the raw incoming file
 *     from R2.  The grayscale output (`bwvideo/{id}.mp4`) remains in R2 and is served
 *     for browser playback via `GET /api/videos/:id/stream`.
 *
 * ## Why Cloudflare Workflows?
 *
 * Each `step.do()` call is **durable**: if the Worker crashes mid-run Cloudflare
 * automatically re-runs from the last completed step rather than from the beginning.
 * That durability is exactly what you need when video processing can take minutes and
 * involves external HTTP calls to a container.
 *
 * ## Current state
 *
 * All five steps are fully implemented. The full pipeline runs end-to-end:
 * raw upload → MP4 transcode → audio extraction → grayscale → finalize.
 *
 * @module workflow
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { generatePresignedUrl } from "./lib/presigned";
import type { VideoWorkflowParams } from "./types";

/**
 * JSON response shape returned by all ffmpeg container processing endpoints
 * (`POST /transcode`, `POST /extract-audio`, `POST /grayscale`).
 *
 * The container always returns one of two shapes:
 * - **Success** (`ok: true`): includes the wall-clock duration of the ffmpeg invocation.
 * - **Failure** (`ok: false`): includes a short error summary and the last 2 000
 *   characters of ffmpeg stderr for debugging.
 *
 * @example
 * ```ts
 * const result = await resp.json<ContainerResult>();
 * if (!result.ok) {
 *   throw new Error(`Processing failed: ${result.error}`);
 * }
 * console.log(`Done in ${result.duration_seconds}s`);
 * ```
 */
type ContainerResult =
  | { ok: true; duration_seconds: number }
  | { ok: false; error: string; stderr?: string };

/**
 * Multi-step workflow that processes an uploaded video from raw format through
 * transcoding, audio extraction, grayscale conversion, and finalisation.
 *
 * ## How to start an instance
 *
 * The workflow is started from the `POST /api/videos/:id/process` route handler after
 * the browser has finished uploading the raw file directly to R2:
 *
 * ```ts
 * await env.VIDEO_WORKFLOW.create({
 *   id: videoId,          // re-use videoId so it is easy to look up later
 *   params: {
 *     videoId,
 *     filename,
 *     originalFormat,     // e.g. "mkv", "webm", "mov"
 *     r2IncomingKey,      // e.g. "incoming/{videoId}.mkv"
 *   },
 * });
 * ```
 *
 * ## Retry behaviour
 *
 * Cloudflare Workflows automatically retries each `step.do()` call up to three
 * times (with exponential back-off) before propagating the error.  The outer
 * `try/catch` in `run()` catches any step that exhausts its retries and writes
 * the failure to D1 so the UI can display the reason.
 *
 * ## Wrangler config requirements (already present in `wrangler.jsonc.tpl`)
 *
 * ```jsonc
 * "workflows": [
 *   {
 *     "binding":    "VIDEO_WORKFLOW",
 *     "name":       "video-processing-workflow",
 *     "class_name": "VideoProcessingWorkflow"   // must match this class name exactly
 *   }
 * ]
 * ```
 *
 * @example
 * ```ts
 * // Check the status of a running instance from a Worker route handler:
 * const instance = await env.VIDEO_WORKFLOW.get(videoId);
 * const status   = await instance.status();
 * // status.status → "running" | "complete" | "errored" | …
 * ```
 */
export class VideoProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  VideoWorkflowParams
> {
  /**
   * Entry point called once per workflow instance.
   *
   * Runs all five processing steps in sequence.  Each step is wrapped in
   * `step.do()` so Cloudflare can checkpoint progress and retry individual
   * steps without re-running earlier ones.
   *
   * An outer `try/catch` catches any step that fails after its retries are
   * exhausted and records the error in D1, ensuring the UI always shows an
   * accurate final status.
   *
   * @param event - Immutable event object containing the workflow payload
   *   (`event.payload`) and metadata such as `event.instanceId`.
   * @param step - Durable step executor.  Call `step.do(name, fn)` to run a
   *   retryable unit of work; call `step.sleep(label, duration)` to pause
   *   execution without consuming resources.
   * @returns Resolves when all steps complete successfully.
   */
  async run(
    event: WorkflowEvent<VideoWorkflowParams>,
    step: WorkflowStep,
  ): Promise<void> {
    // -------------------------------------------------------------------------
    // Unpack the workflow payload.
    //
    //   videoId        — used in every step as the D1 primary key and R2 key prefix.
    //   originalFormat — used in Step 2 to decide whether transcoding is needed.
    //   r2IncomingKey  — used in Step 2 (transcode input) and Step 5 (cleanup).
    //
    const { videoId, originalFormat, r2IncomingKey } = event.payload;

    try {
      // =======================================================================
      // STEP 1: Register
      // =======================================================================
      // Purpose: Flip the D1 status from "uploading" → "processing" before any
      // heavy work begins.  This ensures the UI shows meaningful progress as soon
      // as the workflow starts, even if later steps are still queued.
      //
      // This step is intentionally lightweight — just a single D1 UPDATE.
      // If it fails (e.g. a transient D1 error) Workflows retries it automatically.
      await step.do("register", async () => {
        console.log(
          JSON.stringify({
            step: "register",
            videoId,
            status: "started",
            timestamp: new Date().toISOString(),
          }),
        );

        await this.env.DB.prepare(
          "UPDATE videos SET status = ?, updated_at = ? WHERE id = ?",
        )
          .bind("processing", new Date().toISOString(), videoId)
          .run();

        console.log(
          JSON.stringify({
            step: "register",
            videoId,
            status: "completed",
            timestamp: new Date().toISOString(),
          }),
        );
      });

      // =======================================================================
      // STEP 2: Transcode to MP4
      // =======================================================================
      // Purpose: Normalise the raw upload to a well-formed MP4 with H.264 video
      // and AAC audio so that every downstream step works with a consistent format.
      //
      // Fast-path optimisation: if the incoming file is already MP4, we copy it
      // directly within R2 using the BUCKET binding — no container startup, no
      // network round-trip, no re-encoding.  This is a common case (many screen
      // recordings and phone uploads are already MP4) and avoids unnecessary cost.
      //
      // For all other formats (mkv, webm, mov, avi, …):
      //  1. Generate a presigned GET URL for the raw incoming file.
      //  2. Generate a presigned PUT URL for the normalised output key.
      //  3. Call POST /transcode on the per-video FFmpegContainer instance,
      //     passing both URLs as JSON.  The container downloads, re-encodes with
      //     `ffmpeg -c:v libx264 -c:a aac`, and uploads — the Worker never sees
      //     the raw video bytes (which would exhaust the 128 MB memory limit).
      //
      // The step is retried up to 3 times with a 10-second delay between
      // attempts, which gives the container time to recover from transient errors
      // such as a cold-start timeout or a brief R2 network hiccup.
      //
      // D1 status while running: "transcoding"
      // Input:  r2IncomingKey                (e.g. "incoming/{videoId}.{ext}")
      // Output: `video/{videoId}.mp4`        (stored as r2_video_key in D1)
      await step.do(
        "transcode",
        { retries: { limit: 3, delay: "10 seconds" } },
        async () => {
          console.log(
            JSON.stringify({
              step: "transcode",
              videoId,
              status: "started",
              timestamp: new Date().toISOString(),
            }),
          );

          // Mark the video as actively transcoding so the UI reflects the current
          // pipeline stage immediately, even before the container is warm.
          await this.env.DB.prepare(
            "UPDATE videos SET status = ?, updated_at = ? WHERE id = ?",
          )
            .bind("transcoding", new Date().toISOString(), videoId)
            .run();

          // Compute the output key once — used for both the presigned PUT URL
          // and the final D1 update.
          const outputKey = `video/${videoId}.mp4`;

          if (originalFormat === "mp4") {
            // -----------------------------------------------------------------
            // Fast path: source is already MP4 — stream-copy within R2 via
            // presigned GET → presigned PUT, bypassing the ffmpeg container.
            //
            // We intentionally avoid BUCKET.get() + BUCKET.put() here.  In
            // `wrangler dev`, the Worker BUCKET binding reads/writes the local
            // simulation store (.wrangler/state/v3/r2/), while presigned URLs
            // reach real Cloudflare R2.  The browser upload used a presigned
            // PUT, so the file lives in real R2 — BUCKET.get() would return
            // null and the copy would be silently skipped, causing every
            // downstream step to fail with HTTP 404 on the GET.
            //
            // Using fetch() with presigned URLs guarantees the copy targets real
            // R2 in both local dev and production.  The ReadableStream body is
            // piped directly without buffering, so Worker memory usage is
            // proportional to the streaming chunk size, not the file size.
            //
            // See docs/DECISIONS.md ISSUE-20 for full context.
            // -----------------------------------------------------------------
            const inputUrl = await generatePresignedUrl(
              this.env,
              this.env.R2_BUCKET_NAME,
              r2IncomingKey,
              "GET",
            );
            const outputUrl = await generatePresignedUrl(
              this.env,
              this.env.R2_BUCKET_NAME,
              outputKey,
              "PUT",
            );

            const getResp = await fetch(inputUrl);
            if (!getResp.ok) {
              throw new Error(
                `Fast-path copy: GET ${r2IncomingKey} returned HTTP ${getResp.status}`,
              );
            }
            if (!getResp.body) {
              throw new Error("Fast-path copy: GET response had no body");
            }

            const putResp = await fetch(outputUrl, {
              method: "PUT",
              body: getResp.body,
            });
            if (!putResp.ok) {
              throw new Error(
                `Fast-path copy: PUT ${outputKey} returned HTTP ${putResp.status}`,
              );
            }
          } else {
            // -----------------------------------------------------------------
            // Slow path: non-MP4 format — transcode via the ffmpeg container.
            //
            // Each video has its own named container instance so multiple videos
            // can transcode in parallel without serialisation.  getByName() is
            // idempotent — calling it twice for the same name returns the same
            // underlying instance.
            // -----------------------------------------------------------------
            const inputUrl = await generatePresignedUrl(
              this.env,
              this.env.R2_BUCKET_NAME,
              r2IncomingKey,
              "GET",
            );
            const outputUrl = await generatePresignedUrl(
              this.env,
              this.env.R2_BUCKET_NAME,
              outputKey,
              "PUT",
            );

            const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
            const resp = await container.fetch("http://container/transcode", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                input_url: inputUrl,
                output_url: outputUrl,
              }),
            });

            const result = await resp.json<ContainerResult>();
            if (!result.ok) {
              throw new Error(`Transcode failed: ${result.error}`);
            }
          }

          // Record the output key so downstream steps (extract-audio, grayscale)
          // and the UI (VideoCard) can reference the transcoded file.
          await this.env.DB.prepare(
            "UPDATE videos SET r2_video_key = ?, updated_at = ? WHERE id = ?",
          )
            .bind(outputKey, new Date().toISOString(), videoId)
            .run();

          console.log(
            JSON.stringify({
              step: "transcode",
              videoId,
              status: "completed",
              timestamp: new Date().toISOString(),
            }),
          );
        },
      );

      // =======================================================================
      // STEP 3: Extract audio to MP3
      // =======================================================================
      // Purpose: Produce a standalone audio file that can be downloaded or used
      // independently of the video.  Stored in R2 under the "audio/" prefix.
      //
      // How it works:
      //  1. Flip D1 status to "extracting_audio" so the UI reflects the active stage.
      //  2. Generate a presigned GET URL for "video/{videoId}.mp4" (Step 2 output).
      //  3. Generate a presigned PUT URL for "audio/{videoId}.mp3".
      //  4. Call POST /extract-audio on the per-video FFmpegContainer instance.
      //     The container runs `ffmpeg -i input -vn -c:a libmp3lame output.mp3` —
      //     "-vn" drops the video stream, leaving only the audio track as MP3.
      //  5. Persist the output key as r2_audio_key in D1.
      //
      // The container instance was already warm from Step 2 (within the 60-second
      // sleepAfter window), so this step has no cold-start penalty.
      //
      // D1 status while running: "extracting_audio"
      // Input:  "video/{videoId}.mp4"  (r2_video_key written by Step 2)
      // Output: "audio/{videoId}.mp3"  (stored as r2_audio_key in D1)
      await step.do(
        "extract-audio",
        { retries: { limit: 3, delay: "10 seconds" } },
        async () => {
          console.log(
            JSON.stringify({
              step: "extract-audio",
              videoId,
              status: "started",
              timestamp: new Date().toISOString(),
            }),
          );

          // Mark the video as actively extracting audio so the UI reflects the
          // current pipeline stage immediately.
          await this.env.DB.prepare(
            "UPDATE videos SET status = ?, updated_at = ? WHERE id = ?",
          )
            .bind("extracting_audio", new Date().toISOString(), videoId)
            .run();

          // Presigned GET for the transcoded MP4 produced by Step 2.
          const inputUrl = await generatePresignedUrl(
            this.env,
            this.env.R2_BUCKET_NAME,
            `video/${videoId}.mp4`,
            "GET",
          );

          // Compute the output key once — used for both the presigned PUT URL
          // and the final D1 update.
          const outputKey = `audio/${videoId}.mp3`;
          const outputUrl = await generatePresignedUrl(
            this.env,
            this.env.R2_BUCKET_NAME,
            outputKey,
            "PUT",
          );

          // Re-use the named container instance from Step 2.  getByName() is
          // idempotent — the same Durable Object stub is returned for the same
          // name, and the container is still warm from the transcode step.
          const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
          const resp = await container.fetch("http://container/extract-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input_url: inputUrl,
              output_url: outputUrl,
            }),
          });

          const result = await resp.json<ContainerResult>();
          if (!result.ok) {
            throw new Error(`Audio extraction failed: ${result.error}`);
          }

          // Record the output key so the UI (VideoCard) and any future consumers
          // can reference the extracted audio file in R2.
          await this.env.DB.prepare(
            "UPDATE videos SET r2_audio_key = ?, updated_at = ? WHERE id = ?",
          )
            .bind(outputKey, new Date().toISOString(), videoId)
            .run();

          console.log(
            JSON.stringify({
              step: "extract-audio",
              videoId,
              status: "completed",
              timestamp: new Date().toISOString(),
            }),
          );
        },
      );

      // =======================================================================
      // STEP 4: Create grayscale video
      // =======================================================================
      // Purpose: Apply the `format=gray` ffmpeg filter to produce a black-and-white
      // version of the MP4.  The original colour MP4 is kept in R2 untouched.
      // The grayscale version is the one uploaded to Cloudflare Stream in Step 5.
      //
      // How it works:
      //  1. Flip D1 status to "grayscaling" so the UI reflects the active stage.
      //  2. Generate a presigned GET URL for "video/{videoId}.mp4" (Step 2 output).
      //  3. Generate a presigned PUT URL for "bwvideo/{videoId}.mp4".
      //  4. Call POST /grayscale on the per-video FFmpegContainer instance.
      //     The container runs `ffmpeg -i input -vf format=gray -c:a copy output.mp4` —
      //     `format=gray` desaturates every frame while `-c:a copy` passes the audio
      //     stream through without re-encoding for efficiency.
      //  5. Persist the output key as r2_bw_key in D1.
      //
      // After this step the container has completed all its work.  The 60-second
      // `sleepAfter` window means it will auto-stop shortly after.  Steps 5 and 6
      // operate on R2 objects and the Stream API — no container involvement.
      //
      // D1 status while running: "grayscaling"
      // Input:  "video/{videoId}.mp4"   (r2_video_key written by Step 2)
      // Output: "bwvideo/{videoId}.mp4" (stored as r2_bw_key in D1)
      await step.do(
        "grayscale",
        { retries: { limit: 3, delay: "10 seconds" } },
        async () => {
          console.log(
            JSON.stringify({
              step: "grayscale",
              videoId,
              status: "started",
              timestamp: new Date().toISOString(),
            }),
          );

          // Mark the video as actively converting to grayscale so the UI reflects
          // the current pipeline stage immediately, before the container call begins.
          await this.env.DB.prepare(
            "UPDATE videos SET status = ?, updated_at = ? WHERE id = ?",
          )
            .bind("grayscaling", new Date().toISOString(), videoId)
            .run();

          // Presigned GET for the transcoded MP4 produced by Step 2.
          const inputUrl = await generatePresignedUrl(
            this.env,
            this.env.R2_BUCKET_NAME,
            `video/${videoId}.mp4`,
            "GET",
          );

          // Compute the output key once — used for both the presigned PUT URL
          // and the final D1 update.
          const outputKey = `bwvideo/${videoId}.mp4`;
          const outputUrl = await generatePresignedUrl(
            this.env,
            this.env.R2_BUCKET_NAME,
            outputKey,
            "PUT",
          );

          // Re-use the named container instance from Steps 2 and 3.  getByName() is
          // idempotent — the same Durable Object stub is returned for the same name.
          // The container is still within the 60-second sleepAfter window from Step 3.
          const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
          const resp = await container.fetch("http://container/grayscale", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              input_url: inputUrl,
              output_url: outputUrl,
            }),
          });

          const result = await resp.json<ContainerResult>();
          if (!result.ok) {
            throw new Error(`Grayscale conversion failed: ${result.error}`);
          }

          // Record the output key so Step 5 (finalize) and the UI (VideoCard)
          // can reference the grayscale file in R2 for playback.
          await this.env.DB.prepare(
            "UPDATE videos SET r2_bw_key = ?, updated_at = ? WHERE id = ?",
          )
            .bind(outputKey, new Date().toISOString(), videoId)
            .run();

          console.log(
            JSON.stringify({
              step: "grayscale",
              videoId,
              status: "completed",
              timestamp: new Date().toISOString(),
            }),
          );
        },
      );

      // =======================================================================
      // STEP 5: Finalize
      // =======================================================================
      // Purpose: Mark the pipeline complete and clean up the raw incoming file
      // from R2 to avoid storing redundant data indefinitely.
      //
      // The grayscale output ("bwvideo/{id}.mp4") is the terminal artifact.
      // It stays in R2 and is served for browser playback on demand via the
      // authenticated Worker endpoint GET /api/videos/:id/stream — no external
      // streaming service is required.
      //
      // How it works:
      //  1. DELETE the raw uploaded file (r2IncomingKey) from R2.
      //     The file is no longer needed: the transcoded MP4 ("video/"), the
      //     audio MP3 ("audio/"), and the grayscale MP4 ("bwvideo/") were all
      //     produced from it in Steps 2–4.
      //  2. UPDATE the D1 row to status = "complete".  This is the terminal
      //     state — the UI hides the processing indicator and shows the player.
      //
      // Order matters: delete first, then mark complete.  If the D1 update
      // fails and the step retries, the delete is idempotent (R2 delete on a
      // missing key is a no-op), so re-running is safe.
      //
      // D1 status after this step: "complete"
      // Cleanup: r2IncomingKey deleted from BUCKET
      await step.do("finalize", async () => {
        console.log(
          JSON.stringify({
            step: "finalize",
            videoId,
            status: "started",
            timestamp: new Date().toISOString(),
          }),
        );

        // Delete the raw incoming file from R2.  It has now been transcoded,
        // audio-extracted, and converted to grayscale — keeping it would
        // waste R2 storage without adding value.  R2 delete is idempotent:
        // calling it on a missing key is a no-op, so retrying is safe.
        await this.env.BUCKET.delete(r2IncomingKey);

        // Mark the video as complete in D1.  This is the terminal status
        // transition — the frontend will show the video player once it sees
        // status = "complete".
        await this.env.DB.prepare(
          "UPDATE videos SET status = ?, updated_at = ? WHERE id = ?",
        )
          .bind("complete", new Date().toISOString(), videoId)
          .run();

        console.log(
          JSON.stringify({
            step: "finalize",
            videoId,
            status: "completed",
            timestamp: new Date().toISOString(),
          }),
        );
      });
    } catch (err) {
      // -----------------------------------------------------------------------
      // Error handler — runs if any step above throws after exhausting its retries.
      //
      // We use step.do() here (rather than a raw DB call) for two reasons:
      //  1. Durability — if D1 is temporarily unavailable the update will be
      //     retried, so the error message is never silently lost.
      //  2. Checkpointing — if this step itself has already succeeded in a
      //     previous attempt we skip it rather than writing a duplicate error row.
      // -----------------------------------------------------------------------
      const errorMessage = String(err);

      console.error(
        JSON.stringify({
          source: "VideoProcessingWorkflow",
          event: "workflow_failed",
          videoId,
          error: errorMessage,
          timestamp: new Date().toISOString(),
        }),
      );

      await step.do("mark-error", async () => {
        await this.env.DB.prepare(
          "UPDATE videos SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
        )
          .bind("error", errorMessage, new Date().toISOString(), videoId)
          .run();
      });

      // Re-throw so the Workflow instance is also marked as "errored" in the
      // Cloudflare dashboard — useful for debugging, alerting, and wrangler logs.
      throw err;
    }
  }
}
