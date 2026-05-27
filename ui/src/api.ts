/**
 * API client for the Video Processing Pipeline backend.
 *
 * Contains typed `fetch` wrappers for every `/api/videos` endpoint, keeping
 * all backend communication in one place.  All responses follow the standard
 * envelope shape `{ data: T }` on success and `{ error: string }` on failure.
 *
 * @example
 * ```ts
 * import { createVideo, startProcessing, fetchVideos } from "@/api";
 *
 * const { id, upload_url } = await createVideo("my-video.webm");
 * await fetch(upload_url, { method: "PUT", body: file });
 * await startProcessing(id);
 *
 * const videos = await fetchVideos();
 * ```
 */

/** Base URL prefix for all API requests. */
const API_BASE = "/api";

// ---------------------------------------------------------------------------
// Domain types (mirrored from src/types.ts in the Worker)
// ---------------------------------------------------------------------------

/**
 * All possible status values for a video as it moves through the processing
 * pipeline.  The state machine is linear:
 * `uploading → processing → transcoding → extracting_audio → grayscaling → complete`
 *
 * Any step may transition to `error` on unrecoverable failure.
 *
 * @example
 * ```ts
 * const status: VideoStatus = "transcoding";
 * if (status === "complete") {
 *   console.log("Processing finished — video is ready to play");
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
 * A video record as returned by `GET /api/videos` and `GET /api/videos/:id`.
 *
 * This is the API projection of the D1 `videos` table — internal R2 keys and
 * workflow instance IDs are omitted.  The `play_url` field becomes non-null
 * once the grayscale step completes and the video is ready for playback.
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
  /** Original filename provided at upload time (e.g. `"lecture.mkv"`). */
  filename: string;
  /** File extension without dot (e.g. `"mkv"`, `"mp4"`, `"webm"`). */
  original_format: string;
  /** Current pipeline status. */
  status: VideoStatus;
  /**
   * Worker-relative URL for video playback via the R2 streaming endpoint.
   * Populated as `/api/videos/{id}/stream` once the grayscale step completes.
   * `null` until then.
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
 * Registers a new video upload with the backend and returns a presigned R2
 * PUT URL to which the file should be written directly from the browser.
 *
 * The returned `id` uniquely identifies the video record in D1.  Call
 * {@link startProcessing} with this ID once the PUT completes.
 *
 * @param filename - Original filename including extension (e.g. `"clip.webm"`).
 *   Used by the backend to determine the incoming format and R2 key prefix.
 * @returns An object with the server-assigned video `id` and a presigned
 *   `upload_url` (valid for direct `PUT` to R2).
 * @throws {@link Error} if the server responds with a non-2xx status code.
 *
 * @example
 * ```ts
 * const { id, upload_url } = await createVideo("demo.webm");
 * // Next: PUT the file bytes to upload_url, then call startProcessing(id)
 * ```
 */
export async function createVideo(
  filename: string,
): Promise<{ id: string; upload_url: string }> {
  const res = await fetch(`${API_BASE}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  if (!res.ok) throw new Error(`Failed to create video: ${res.status}`);
  const json = (await res.json()) as {
    data: { id: string; upload_url: string };
  };
  return json.data;
}

/**
 * Notifies the backend that the direct R2 upload has completed and triggers
 * the `VideoProcessingWorkflow` for the given video ID.
 *
 * Must be called after a successful PUT to the presigned URL returned by
 * {@link createVideo}.  The video status transitions from `"uploading"` to
 * `"processing"` and beyond once the workflow starts.
 *
 * @param id - The video ID returned by {@link createVideo}.
 * @throws {@link Error} if the server responds with a non-2xx status code.
 *
 * @example
 * ```ts
 * await startProcessing("a1b2c3d4-...");
 * // The VideoProcessingWorkflow is now running for this video
 * ```
 */
export async function startProcessing(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/videos/${id}/process`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Failed to start processing: ${res.status}`);
}

/**
 * Fetches the full list of video records from the backend.
 *
 * Calls `GET /api/videos`, which returns all videos in reverse-chronological
 * order (newest first).  Used by `VideoList` on mount to populate the
 * dashboard grid.  This function does **not** perform polling — callers are
 * responsible for scheduling re-fetches as needed (see ISSUE-23 for polling
 * implementation).
 *
 * @returns An array of {@link VideoResource} objects.  An empty array is
 *   returned when the user has not yet uploaded any videos.
 * @throws {@link Error} if the server responds with a non-2xx status code.
 *
 * @example
 * ```ts
 * const videos = await fetchVideos();
 * const complete = videos.filter((v) => v.status === "complete");
 * ```
 */
export async function fetchVideos(): Promise<VideoResource[]> {
  const res = await fetch(`${API_BASE}/videos`);
  if (!res.ok) throw new Error(`Failed to fetch videos: ${res.status}`);
  const json = (await res.json()) as { data: VideoResource[] };
  return json.data;
}
