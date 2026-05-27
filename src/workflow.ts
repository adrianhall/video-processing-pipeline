/**
 * Cloudflare Workflow orchestrating the multi-step video processing pipeline.
 *
 * `VideoProcessingWorkflow` is the core of this project. It sequences six
 * independently-retriable steps: registering the video in D1, transcoding to
 * MP4, extracting audio, creating a grayscale copy, uploading the result to
 * Cloudflare Stream, and finalising the D1 record.
 *
 * This file is a **stub** — only the class declaration and the mandatory
 * `run` signature are present so Wrangler can validate the Worker entry
 * point. The full step-by-step implementation will be added in the workflow
 * implementation issue.
 *
 * ## Wrangler config requirements (already present in wrangler.jsonc.tpl)
 * - `workflows[].binding` = `"VIDEO_WORKFLOW"`
 * - `workflows[].class_name` = `"VideoProcessingWorkflow"`
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
 * transcoding, audio extraction, grayscale conversion, and Stream upload.
 *
 * Instances are created by the Worker API after the browser completes a
 * direct R2 upload:
 *
 * ```ts
 * await env.VIDEO_WORKFLOW.create({
 *   id: videoId,
 *   params: { videoId, filename, originalFormat, r2IncomingKey },
 * });
 * ```
 *
 * Each step is independently retriable (Cloudflare Workflows built-in retry).
 * The workflow writes status updates to D1 so the polling API can surface
 * real-time progress to the browser.
 *
 * @example
 * ```ts
 * // Start the workflow from a Worker route handler
 * const instance = await env.VIDEO_WORKFLOW.create({
 *   id: videoId,
 *   params: {
 *     videoId,
 *     filename: "lecture.mkv",
 *     originalFormat: "mkv",
 *     r2IncomingKey: `incoming/${videoId}.mkv`,
 *   },
 * });
 * console.log("Workflow started:", instance.id);
 * ```
 */
export class VideoProcessingWorkflow extends WorkflowEntrypoint<
  Env,
  VideoWorkflowParams
> {
  /**
   * Entry point for each workflow instance.
   *
   * Steps will be implemented in the workflow implementation issue. Until
   * then this throws immediately so the workflow instance is recorded as
   * failed rather than hanging indefinitely.
   *
   * @param event - Immutable event containing the workflow payload and metadata.
   * @param step - Durable step executor used to run, sleep, and retry steps.
   * @returns Promise that resolves when all steps complete successfully.
   */
  async run(
    event: WorkflowEvent<VideoWorkflowParams>,
    step: WorkflowStep,
  ): Promise<void> {
    // Stub — full implementation in the workflow issue.
    // Referencing step suppresses the unused-variable lint error and ensures
    // the signature matches the abstract base class exactly.
    void step;
    throw new Error(
      `VideoProcessingWorkflow not yet implemented (videoId: ${event.payload.videoId})`,
    );
  }
}
