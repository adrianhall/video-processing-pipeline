/**
 * Cloudflare Workflow that orchestrates the multi-step video processing pipeline.
 *
 * ## What this file does
 *
 * `VideoProcessingWorkflow` is the **star of this project**. It sequences six
 * independently-retriable steps that take a raw uploaded video all the way to a
 * grayscale stream-ready MP4 on Cloudflare Stream:
 *
 *  1. **Register** — flip the D1 status to `"processing"` so the UI updates immediately.
 *  2. **Transcode** — normalise the upload to MP4 / H.264 + AAC via the ffmpeg container.
 *     If the source file is already MP4, the file is copied directly in R2 (no container call).
 *  3. **Extract audio** — pull the audio track to a standalone MP3 file in R2.
 *  4. **Grayscale** — re-encode the MP4 with `format=gray` while keeping the audio.
 *  5. **Upload to Stream** — ingest the grayscale MP4 into Cloudflare Stream via the
 *     copy-from-URL API for adaptive-bitrate playback.
 *  6. **Finalize** — mark the D1 record `"complete"`, store the Stream URL, and delete
 *     the raw incoming file from R2.
 *
 * ## Why Cloudflare Workflows?
 *
 * Each `step.do()` call is **durable**: if the Worker crashes mid-run Cloudflare
 * automatically re-runs from the last completed step rather than from the beginning.
 * That durability is exactly what you need when video processing can take minutes and
 * involves external HTTP calls to a container and the Stream API.
 *
 * ## Current state
 *
 * All six steps are fully implemented. The full pipeline runs end-to-end:
 * raw upload → MP4 transcode → audio extraction → grayscale → Stream upload → finalize.
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
 * JSON response shape returned by the Cloudflare Stream "copy from URL" API
 * (`POST /client/v4/accounts/{account_id}/stream/copy`).
 *
 * The API always returns a top-level `success` boolean.  On success, `result`
 * contains the new video's metadata including its unique `uid` and a `preview`
 * watch URL.  On failure, `errors` holds one or more error objects with a
 * numeric code and a human-readable message.
 *
 * The `preview` URL has the form:
 * `https://customer-<CODE>.cloudflarestream.com/<UID>/watch`
 * where `<CODE>` is the account-specific customer subdomain assigned by
 * Cloudflare Stream (distinct from the account ID).  Replacing `/watch` with
 * `/iframe` yields the standard embed URL expected by the Stream player.
 *
 * @example
 * ```ts
 * const data = await resp.json<StreamApiResponse>();
 * if (!data.success) {
 *   throw new Error(`Stream upload failed: ${JSON.stringify(data.errors)}`);
 * }
 * const streamUrl = data.result.preview.replace("/watch", "/iframe");
 * ```
 */
type StreamApiResponse =
  | {
      success: true;
      errors: [];
      result: {
        /** Unique video UID assigned by Cloudflare Stream. */
        uid: string;
        /**
         * Direct watch URL for the video.  Replace "/watch" with "/iframe" to
         * obtain the embeddable iframe URL understood by the Stream player.
         */
        preview: string;
      };
    }
  | {
      success: false;
      errors: Array<{ code: number; message: string }>;
      result: null;
    };

/**
 * Multi-step workflow that processes an uploaded video from raw format through
 * transcoding, audio extraction, grayscale conversion, and Cloudflare Stream upload.
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
   * Runs all six processing steps in sequence.  Each step is wrapped in
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
    // All four fields are declared here so the reader can see the complete set
    // of data available throughout the pipeline at a glance.
    //
    //   videoId        — used in every step as the D1 primary key and R2 key prefix.
    //   filename       — used in Step 5 as the display name for the Stream upload.
    //   originalFormat — used in Step 2 to decide whether transcoding is needed.
    //   r2IncomingKey  — used in Step 2 (transcode input) and Step 6 (cleanup).
    //
    const { videoId, filename, originalFormat, r2IncomingKey } = event.payload;

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
        await this.env.DB.prepare(
          "UPDATE videos SET status = ?, updated_at = ? WHERE id = ?",
        )
          .bind("processing", new Date().toISOString(), videoId)
          .run();
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
            // Fast path: source is already MP4 — copy the R2 object directly.
            //
            // Using the BUCKET binding is free of egress charges and orders of
            // magnitude faster than spinning up a container just to copy bytes.
            // We only skip this path if `obj` is null (object was deleted between
            // the upload and workflow start — highly unlikely but handled).
            // -----------------------------------------------------------------
            const obj = await this.env.BUCKET.get(r2IncomingKey);
            if (obj) {
              await this.env.BUCKET.put(outputKey, obj.body);
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

          // Record the output key so Step 5 (upload-to-stream) and the UI
          // (VideoCard) can reference the grayscale file in R2.
          await this.env.DB.prepare(
            "UPDATE videos SET r2_bw_key = ?, updated_at = ? WHERE id = ?",
          )
            .bind(outputKey, new Date().toISOString(), videoId)
            .run();
        },
      );

      // =======================================================================
      // STEP 5: Upload grayscale video to Cloudflare Stream
      // =======================================================================
      // Purpose: Ingest the grayscale MP4 into Cloudflare Stream so it can be
      // served as an adaptive-bitrate HLS/DASH stream via the Stream player.
      // Uses the "copy from URL" API — Stream pulls the file from R2 directly,
      // so the Worker never proxies the video bytes.
      //
      // How it works:
      //  1. Flip D1 status to "uploading_to_stream" so the UI reflects the stage.
      //  2. Generate a 1-hour presigned GET URL for "bwvideo/{videoId}.mp4".
      //  3. POST to the Stream "copy from URL" API, passing the presigned URL and
      //     the original filename as metadata.
      //  4. Extract the video UID and derive the iframe embed URL from the
      //     response's `preview` field (replace "/watch" with "/iframe").
      //  5. Persist stream_video_id and stream_url to D1.
      //
      // The step is retried up to 3 times with a 30-second delay to handle
      // transient Stream API errors or temporary network issues.
      //
      // D1 status while running: "uploading_to_stream"
      // Input:  "bwvideo/{videoId}.mp4" (r2_bw_key from Step 4)
      // Output: Cloudflare Stream UID and iframe embed URL (stream_video_id and
      //         stream_url stored in D1 for the frontend player)
      await step.do(
        "upload-to-stream",
        { retries: { limit: 3, delay: "30 seconds" } },
        async () => {
          // Mark the video as actively uploading to Stream so the UI reflects
          // the current pipeline stage before the API call begins.
          await this.env.DB.prepare(
            "UPDATE videos SET status = ?, updated_at = ? WHERE id = ?",
          )
            .bind("uploading_to_stream", new Date().toISOString(), videoId)
            .run();

          // Generate a presigned GET URL for Stream to download the grayscale
          // video from R2.  One hour is more than sufficient for the Stream API
          // to initiate its internal download before the URL expires.
          const videoUrl = await generatePresignedUrl(
            this.env,
            this.env.R2_BUCKET_NAME,
            `bwvideo/${videoId}.mp4`,
            "GET",
            3600,
          );

          // Call the Cloudflare Stream "copy from URL" API.
          // Stream pulls the file from R2 via the presigned URL; the Worker
          // never sees the video bytes, which would exhaust the 128 MB memory
          // limit.  The `meta.name` field sets the display name in the Stream
          // dashboard and is useful for debugging.
          const resp = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/stream/copy`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${this.env.CF_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ url: videoUrl, meta: { name: filename } }),
            },
          );

          const data = await resp.json<StreamApiResponse>();
          if (!data.success) {
            throw new Error(
              `Stream upload failed: ${JSON.stringify(data.errors)}`,
            );
          }

          // The video UID is stored for the @cloudflare/stream-react player,
          // which accepts a UID as its `src` prop.
          const streamVideoId = data.result.uid;

          // Derive the iframe embed URL from the preview URL returned by the
          // Stream API.  The preview URL is:
          //   https://customer-<CODE>.cloudflarestream.com/<UID>/watch
          // where <CODE> is the account-specific customer subdomain — distinct
          // from the account ID.  We cannot construct this URL from env vars
          // alone, so we derive it from the response instead.
          const streamUrl = data.result.preview.replace("/watch", "/iframe");

          await this.env.DB.prepare(
            "UPDATE videos SET stream_video_id = ?, stream_url = ?, updated_at = ? WHERE id = ?",
          )
            .bind(streamVideoId, streamUrl, new Date().toISOString(), videoId)
            .run();
        },
      );

      // =======================================================================
      // STEP 6: Finalize
      // =======================================================================
      // Purpose: Mark the pipeline complete and clean up the raw incoming file
      // from R2 to avoid storing redundant data indefinitely.
      //
      // How it works:
      //  1. DELETE the raw uploaded file (r2IncomingKey) from R2.
      //     The file is no longer needed: the transcoded MP4 ("video/"), the
      //     audio MP3 ("audio/"), the grayscale MP4 ("bwvideo/"), and the
      //     Stream copy all originate from Steps 2–5.
      //  2. UPDATE the D1 row to status = "complete".  This is the terminal
      //     state — the UI will hide the processing indicator and show the
      //     Stream player.
      //
      // Order matters: delete first, then mark complete.  If the D1 update
      // fails and the step retries, the delete is idempotent (R2 delete on a
      // missing key is a no-op), so re-running is safe.
      //
      // D1 status after this step: "complete"
      // Cleanup: r2IncomingKey deleted from BUCKET
      await step.do("finalize", async () => {
        // Delete the raw incoming file from R2.  It has now been transcoded,
        // audio-extracted, converted to grayscale, and ingested into Stream —
        // keeping it would waste R2 storage without adding value.
        // R2 delete is idempotent: calling it on a missing key is a no-op, so
        // retrying this step is safe.
        await this.env.BUCKET.delete(r2IncomingKey);

        // Mark the video as complete in D1.  This is the last status transition
        // in the pipeline and signals to the UI that Stream playback is ready.
        await this.env.DB.prepare(
          "UPDATE videos SET status = ?, updated_at = ? WHERE id = ?",
        )
          .bind("complete", new Date().toISOString(), videoId)
          .run();
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
      await step.do("mark-error", async () => {
        await this.env.DB.prepare(
          "UPDATE videos SET status = ?, error_message = ?, updated_at = ? WHERE id = ?",
        )
          .bind("error", String(err), new Date().toISOString(), videoId)
          .run();
      });

      // Re-throw so the Workflow instance is also marked as "errored" in the
      // Cloudflare dashboard — useful for debugging, alerting, and wrangler logs.
      throw err;
    }
  }
}
