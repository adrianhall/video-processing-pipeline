/**
 * Workflow status endpoint for the Video Processing Pipeline.
 *
 * This module exports a Hono sub-router that implements the status polling
 * endpoint consumed by the frontend to show real-time processing progress:
 *
 * - `GET /:id/status` (mounted at `/api/videos`) — looks up the video by ID
 *   in D1, then queries the live Cloudflare Workflow instance status.  Returns
 *   both the D1 pipeline status and the raw `InstanceStatus` object from the
 *   Workflow runtime so the frontend can display step-level progress.
 *
 * Both the D1 status and the workflow instance status are returned together to
 * avoid the client needing two round trips.  If the workflow instance can no
 * longer be fetched (e.g., the instance was cleaned up after completion),
 * the response degrades gracefully and returns `workflow_status: null`.
 *
 * @module api/status
 */

import type { AuthVariables } from "@adrianhall/cloudflare-auth";
import { Hono } from "hono";

/** Hono application type that wires the generated `Env` bindings and auth variables. */
type AppEnv = { Bindings: Env; Variables: AuthVariables };

/**
 * Minimal D1 row shape for the status query.
 *
 * Only `id`, `status`, and `workflow_id` are selected — the remaining
 * columns are not needed for this response.
 */
interface VideoStatusRow {
  /** UUID primary key. */
  id: string;
  /** Current pipeline status stored in D1 (e.g. `"transcoding"`, `"complete"`). */
  status: string;
  /**
   * Cloudflare Workflow instance ID.  Set by `POST /api/videos/:id/process`.
   * `null` if the workflow has not yet been started (video still uploading).
   */
  workflow_id: string | null;
}

/**
 * Response payload shape for `GET /api/videos/:id/status`.
 *
 * Combines the D1 pipeline status with the live Cloudflare Workflow instance
 * status so the frontend has everything it needs in a single request.
 *
 * @example
 * ```ts
 * const response: VideoStatusResponse = {
 *   id: "01960b1e-4a7b-7d99-b90c-12e0f73c69d0",
 *   status: "transcoding",
 *   workflow_status: { status: "running" },
 * };
 * ```
 */
interface VideoStatusResponse {
  /** UUID of the video record in D1. */
  id: string;
  /** Current pipeline status from D1 (e.g. `"transcoding"`, `"complete"`). */
  status: string;
  /**
   * Live Workflow instance status from the Cloudflare runtime.
   * `null` when the workflow instance is unavailable (not started or cleaned up).
   */
  workflow_status: InstanceStatus | null;
}

/**
 * Hono sub-router for the Workflow status endpoint.
 *
 * Mount this router into the root app at `/api/videos`:
 *
 * ```ts
 * import { statusRouter } from "./api/status";
 * app.route("/api/videos", statusRouter);
 * ```
 *
 * The router exposes one route:
 * - `GET /:id/status` — combined D1 + live Workflow instance status
 */
export const statusRouter = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /:id/status — Return combined D1 + Workflow instance status
// ---------------------------------------------------------------------------

/**
 * Returns the current pipeline status for a video, combining the D1 record
 * status with the live Cloudflare Workflow instance status.
 *
 * ## Steps
 * 1. Query D1 for `id`, `status`, and `workflow_id` by video ID.
 * 2. Return `404` if no record exists.
 * 3. Return `400` if `workflow_id` is null (workflow not yet started).
 * 4. Fetch the Workflow instance via `env.VIDEO_WORKFLOW.get(workflow_id)`.
 * 5. Call `instance.status()` to retrieve the live execution status.
 * 6. Return the combined response envelope.
 *
 * If steps 4 or 5 throw (e.g., the instance was cleaned up after the
 * workflow completed), the response degrades gracefully: `workflow_status`
 * is set to `null` and only the D1 status is returned.
 *
 * @param id - UUID of the video (path parameter `:id`).
 *
 * @returns `200 { data: VideoStatusResponse }` when the video and workflow are found.
 *   `404 { error: string }` when no video record matches `id`.
 *   `400 { error: string }` when `workflow_id` is null (upload not yet processed).
 *   `500 { error: string; detail?: string }` for unexpected D1 failures.
 *
 * @example
 * ```http
 * GET /api/videos/01960b1e-4a7b-7d99-b90c-12e0f73c69d0/status
 *
 * → 200
 * {
 *   "data": {
 *     "id": "01960b1e-4a7b-7d99-b90c-12e0f73c69d0",
 *     "status": "transcoding",
 *     "workflow_status": { "status": "running" }
 *   }
 * }
 *
 * GET /api/videos/01960b1e-4a7b-7d99-b90c-12e0f73c69d0/status
 * (when workflow_id is null — upload not yet triggered)
 *
 * → 400
 * { "error": "Workflow not started for this video" }
 * ```
 */
statusRouter.get("/:id/status", async (c) => {
  const { id } = c.req.param();

  // 1. Look up the video in D1 — select only the columns this endpoint needs.
  let video: VideoStatusRow | null;
  try {
    video = await c.env.DB.prepare(
      "SELECT id, status, workflow_id FROM videos WHERE id = ?",
    )
      .bind(id)
      .first<VideoStatusRow>();
  } catch (err) {
    return c.json(
      {
        error: "Failed to retrieve video",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  // 2. 404 if no record found.
  if (video === null) {
    return c.json({ error: "Video not found" }, 404);
  }

  // 3. 400 if the workflow has not been started yet (upload still in progress).
  if (video.workflow_id === null) {
    return c.json({ error: "Workflow not started for this video" }, 400);
  }

  // 4 & 5. Fetch the live Workflow instance status.
  //
  // Wrapped in try-catch because the instance may have been cleaned up after
  // the workflow completed or exceeded its retention period.  In that case we
  // fall back to null so the client still receives the D1 status.
  let workflowStatus: InstanceStatus | null = null;
  try {
    const instance = await c.env.VIDEO_WORKFLOW.get(video.workflow_id);
    workflowStatus = await instance.status();
  } catch {
    // Degraded response — instance unavailable; D1 status is still returned.
    workflowStatus = null;
  }

  // 6. Return the combined response inside the standard success envelope.
  const responseData: VideoStatusResponse = {
    id: video.id,
    status: video.status,
    workflow_status: workflowStatus,
  };
  return c.json({ data: responseData });
});
