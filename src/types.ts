/**
 * Shared TypeScript types for the Video Processing Pipeline.
 *
 * This module contains all domain types used across the Worker API, Workflow,
 * and Container. Centralising them here prevents circular imports and gives
 * future consumers (tests, tooling) a single import path.
 *
 * @module types
 */

/**
 * All possible status values for a video as it moves through the pipeline.
 *
 * The state machine is linear and forward-only:
 *   uploading → processing → transcoding → extracting_audio → grayscaling → complete
 *
 * Any step may transition to `error` on unrecoverable failure.  The final
 * output (`bwvideo/{id}.mp4` in R2) is served directly by the Worker via
 * `GET /api/videos/:id/stream` — no external streaming service is required.
 *
 * @example
 * ```ts
 * const status: VideoStatus = "transcoding";
 * if (status === "error") {
 *   console.error("Video processing failed");
 * }
 * ```
 */
export type VideoStatus =
  | "uploading"
  | "processing"
  | "transcoding"
  | "extracting_audio"
  | "grayscaling"
  | "complete"
  | "error";

/**
 * Parameters passed to the `VideoProcessingWorkflow` when an instance is
 * created.  These are serialised as JSON into the Workflow event payload so
 * all values must be JSON-serialisable primitives.
 *
 * @example
 * ```ts
 * const params: VideoWorkflowParams = {
 *   videoId: "01960b1e-4a7b-7d99-b90c-12e0f73c69d0",
 *   filename: "lecture.mkv",
 *   originalFormat: "mkv",
 *   r2IncomingKey: "incoming/01960b1e-4a7b-7d99-b90c-12e0f73c69d0.mkv",
 * };
 * await env.VIDEO_WORKFLOW.create({ params });
 * ```
 */
export interface VideoWorkflowParams {
  /** UUID of the video record in D1 (also used as the R2 key prefix). */
  videoId: string;
  /** Original filename as provided by the browser (e.g. `"lecture.mkv"`). */
  filename: string;
  /**
   * File extension without the leading dot (e.g. `"mkv"`, `"mp4"`, `"webm"`).
   * Used to determine whether transcoding is required and to build R2 keys.
   */
  originalFormat: string;
  /**
   * Full R2 object key for the raw uploaded file (e.g. `"incoming/{videoId}.mkv"`).
   * The Workflow reads from this key in the first processing step.
   */
  r2IncomingKey: string;
}

/**
 * Standard success response envelope returned by all API endpoints.
 *
 * Wrapping the payload in `{ data: T }` makes success/error discrimination
 * trivial on the client and keeps the response shape consistent across
 * every endpoint.
 *
 * @typeParam T - The type of the response payload.
 *
 * @example
 * ```ts
 * const response: ApiSuccess<VideoResource> = {
 *   data: { id: "abc", filename: "clip.mp4", status: "complete", ... },
 * };
 * ```
 */
export interface ApiSuccess<T> {
  /** The response payload. */
  data: T;
}

/**
 * Standard error response envelope returned by all API endpoints on failure.
 *
 * Use `error` for the user-facing summary and `detail` for the technical
 * detail (e.g. the caught exception message) that aids debugging.
 *
 * @example
 * ```ts
 * const response: ApiError = {
 *   error: "Video not found",
 *   detail: "No row with id=abc in the videos table",
 * };
 * ```
 */
export interface ApiError {
  /** Short, human-readable error summary (e.g. `"Video not found"`). */
  error: string;
  /**
   * Optional technical detail for debugging (e.g. exception message or
   * SQL error text).  Not shown to end users in production UI.
   */
  detail?: string;
}

/**
 * A video record as returned by the API (`GET /api/videos` and
 * `GET /api/videos/:id`).
 *
 * This is a projection of the D1 `videos` table that exposes only the fields
 * relevant to the client.  Internal R2 keys and workflow instance IDs are
 * omitted from this type.
 *
 * @example
 * ```ts
 * const video: VideoResource = {
 *   id: "01960b1e-4a7b-7d99-b90c-12e0f73c69d0",
 *   filename: "lecture.mkv",
 *   original_format: "mkv",
 *   status: "complete",
 *   play_url: "/api/videos/01960b1e-4a7b-7d99-b90c-12e0f73c69d0/stream",
 *   error_message: null,
 *   created_at: "2025-05-27T10:00:00.000Z",
 *   updated_at: "2025-05-27T10:05:23.000Z",
 * };
 * ```
 */
export interface VideoResource {
  /** UUID primary key — matches the D1 `videos.id` column. */
  id: string;
  /** Original filename provided at upload time. */
  filename: string;
  /** File extension without dot (e.g. `"mkv"`, `"mp4"`). */
  original_format: string;
  /** Current pipeline status. */
  status: VideoStatus;
  /**
   * Worker-relative URL for video playback via the R2 streaming endpoint.
   * Populated as `/api/videos/{id}/stream` once `r2_bw_key` is set
   * (i.e. after the grayscale step completes).  `null` until then.
   *
   * The endpoint streams the grayscale MP4 directly from R2 and supports
   * HTTP Range requests for browser seek.
   */
  play_url: string | null;
  /**
   * Human-readable error description when `status === "error"`.
   * `null` for all other statuses.
   */
  error_message: string | null;
  /** ISO 8601 timestamp — when the video record was created. */
  created_at: string;
  /** ISO 8601 timestamp — when the video record was last updated. */
  updated_at: string;
}

/**
 * Response body returned by `POST /api/videos`.
 *
 * The client must PUT the file directly to `upload_url` (a presigned R2 URL)
 * and then call `POST /api/videos/:id/process` once the upload completes.
 * The Worker never proxies the file body — direct upload avoids the 100 MB
 * Worker body limit.
 *
 * @example
 * ```ts
 * const initResponse: UploadInitResponse = {
 *   id: "01960b1e-4a7b-7d99-b90c-12e0f73c69d0",
 *   upload_url: "https://video-pipeline-bucket.r2.cloudflarestorage.com/incoming/...?X-Amz-Signature=...",
 * };
 * // Client: PUT initResponse.upload_url with the file body
 * ```
 */
export interface UploadInitResponse {
  /** UUID of the newly created video record. */
  id: string;
  /**
   * Presigned R2 PUT URL valid for direct browser-to-R2 upload.
   * Expires after 1 hour.  Must be used with a single PUT request
   * whose `Content-Type` matches the one provided at registration.
   */
  upload_url: string;
}
