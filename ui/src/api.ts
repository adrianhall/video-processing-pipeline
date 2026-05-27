/**
 * API client for the Video Processing Pipeline backend.
 *
 * Contains typed `fetch` wrappers for every `/api/videos` endpoint, keeping
 * all backend communication in one place.  All responses follow the standard
 * envelope shape `{ data: T }` on success and `{ error: string }` on failure.
 *
 * @example
 * ```ts
 * import { createVideo, startProcessing } from "@/api";
 *
 * const { id, upload_url } = await createVideo("my-video.webm");
 * await fetch(upload_url, { method: "PUT", body: file });
 * await startProcessing(id);
 * ```
 */

/** Base URL prefix for all API requests. */
const API_BASE = "/api";

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
