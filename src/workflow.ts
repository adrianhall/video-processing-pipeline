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
 * Step 1 is fully implemented. Steps 2–6 are scaffolded as clearly-labelled
 * placeholder comments that describe what each step will do and which R2 keys it
 * reads / writes. They will be filled in by ISSUE-15 through ISSUE-18.
 *
 * @module workflow
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { VideoWorkflowParams } from "./types";

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
    // filename, originalFormat, and r2IncomingKey are referenced in the placeholder
    // step comments below and will be wired up in ISSUE-15 through ISSUE-18.
    // biome-ignore lint/correctness/noUnusedVariables: used in Steps 2–6 (ISSUE-15–18)
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
      // STEP 2: Transcode to MP4  (ISSUE-15)
      // =======================================================================
      // Purpose: Normalise the raw upload to a well-formed MP4 with H.264 video
      // and AAC audio so that every downstream step works with a consistent format.
      // Files already in MP4 with the right codecs skip transcoding (fast path).
      //
      // How it works:
      //  1. The workflow generates a presigned GET URL for r2IncomingKey.
      //  2. The workflow generates a presigned PUT URL for "video/{videoId}.mp4".
      //  3. The workflow calls POST /transcode on the FFmpegContainer instance,
      //     passing both URLs.  The container downloads, re-encodes, and uploads
      //     — the Worker never sees the raw bytes.
      //
      // D1 status while running: "transcoding"
      // Input:  r2IncomingKey         (e.g. "incoming/{videoId}.{originalFormat}")
      // Output: "video/{videoId}.mp4" (stored as r2_video_key in D1)
      //
      // TODO (ISSUE-15): await step.do("transcode", async () => { … });

      // =======================================================================
      // STEP 3: Extract audio to MP3  (ISSUE-16)
      // =======================================================================
      // Purpose: Produce a standalone audio file that can be downloaded or used
      // independently of the video.  Stored in R2 under the "audio/" prefix.
      //
      // How it works:
      //  1. Presigned GET for "video/{videoId}.mp4" (output of Step 2).
      //  2. Presigned PUT for "audio/{videoId}.mp3".
      //  3. POST /extract-audio on the FFmpegContainer.
      //
      // D1 status while running: "extracting_audio"
      // Input:  "video/{videoId}.mp4"  (r2_video_key from Step 2)
      // Output: "audio/{videoId}.mp3"  (stored as r2_audio_key in D1)
      //
      // TODO (ISSUE-16): await step.do("extract-audio", async () => { … });

      // =======================================================================
      // STEP 4: Create grayscale video  (ISSUE-17)
      // =======================================================================
      // Purpose: Apply the `format=gray` ffmpeg filter to produce a black-and-white
      // version of the MP4.  The original colour MP4 is kept in R2 untouched.
      // The grayscale version is the one uploaded to Cloudflare Stream.
      //
      // How it works:
      //  1. Presigned GET for "video/{videoId}.mp4" (output of Step 2).
      //  2. Presigned PUT for "bwvideo/{videoId}.mp4".
      //  3. POST /grayscale on the FFmpegContainer.
      //
      // D1 status while running: "grayscaling"
      // Input:  "video/{videoId}.mp4"   (r2_video_key from Step 2)
      // Output: "bwvideo/{videoId}.mp4" (stored as r2_bw_key in D1)
      //
      // TODO (ISSUE-17): await step.do("grayscale", async () => { … });

      // =======================================================================
      // STEP 5: Upload grayscale video to Cloudflare Stream  (ISSUE-18)
      // =======================================================================
      // Purpose: Ingest the grayscale MP4 into Cloudflare Stream so it can be
      // served as an adaptive-bitrate HLS/DASH stream via the Stream player.
      // Uses the "copy from URL" API — Stream pulls the file from R2 directly.
      //
      // How it works:
      //  1. Generate a presigned GET URL for "bwvideo/{videoId}.mp4" (valid 1 h).
      //  2. POST to the Stream API with the presigned URL and filename as metadata.
      //  3. Poll Stream until readyToStream === true (or sleep and check in Step 6).
      //
      // D1 status while running: "uploading_to_stream"
      // Input:  "bwvideo/{videoId}.mp4" (r2_bw_key from Step 4)
      // Output: Cloudflare Stream UID and playback URL (stored as stream_video_id
      //         and stream_url in D1)
      //
      // TODO (ISSUE-18): await step.do("upload-to-stream", async () => { … });

      // =======================================================================
      // STEP 6: Finalize  (ISSUE-18)
      // =======================================================================
      // Purpose: Mark the pipeline complete, persist the Stream playback URL, and
      // clean up the raw incoming file from R2 to avoid storing redundant data.
      //
      // How it works:
      //  1. UPDATE videos SET status = "complete", stream_url = …, updated_at = …
      //  2. DELETE the r2IncomingKey object from BUCKET (raw upload no longer needed).
      //
      // Input:  r2IncomingKey (to delete), stream_url (from Step 5)
      // Output: filename recorded in D1 history for audit; stream_url surfaced to UI
      //
      // TODO (ISSUE-18): await step.do("finalize", async () => { … });
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
