/**
 * Video read endpoints for the Video Processing Pipeline.
 *
 * This module exports a Hono sub-router that implements the two read-path
 * endpoints consumed by the frontend dashboard:
 *
 * - `GET /` (mounted at `/api/videos`) — returns all video records ordered
 *   by `created_at DESC`.  Only exposes columns that are safe to share with
 *   the client; internal R2 keys and Workflow instance IDs are omitted.
 *
 * - `GET /:id` — returns a single video record by its UUID primary key, or
 *   `404` if no matching record exists.
 *
 * Both routes require authentication (enforced by the parent app's middleware
 * before these handlers are invoked) and return the standard
 * `{ data: T }` / `{ error, detail? }` envelope.
 *
 * @module api/videos
 */

import type { AuthVariables } from "@adrianhall/cloudflare-auth";
import { Hono } from "hono";
import type { VideoResource } from "../types";

/** Hono application type that wires the generated `Env` bindings and auth variables. */
type AppEnv = { Bindings: Env; Variables: AuthVariables };

/**
 * SQL SELECT clause listing the columns returned to the client.
 *
 * Explicitly excludes internal implementation details (`r2_incoming_key`,
 * `r2_video_key`, `r2_audio_key`, `r2_bw_key`, `workflow_id`) that have
 * no meaning to the frontend and would leak storage topology.
 */
const SAFE_COLUMNS =
  "id, filename, original_format, status, stream_url, error_message, created_at, updated_at";

/**
 * Hono sub-router for video read endpoints.
 *
 * Mount this router into the root app at `/api/videos`:
 *
 * ```ts
 * import { videosRouter } from "./api/videos";
 * app.route("/api/videos", videosRouter);
 * ```
 *
 * Both the upload router and this router may be mounted at the same path
 * prefix without conflict — the upload router uses `POST` methods while this
 * router uses `GET` methods.
 *
 * The router exposes two routes:
 * - `GET /` — list all videos ordered by `created_at DESC`
 * - `GET /:id` — get a single video by UUID
 */
export const videosRouter = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET / — List all videos
// ---------------------------------------------------------------------------

/**
 * Returns all video records ordered by creation time (newest first).
 *
 * Queries the D1 `videos` table and returns only the columns that are safe
 * to expose to the client.  Internal R2 object keys (`r2_incoming_key`,
 * `r2_video_key`, `r2_audio_key`, `r2_bw_key`) and the Workflow instance ID
 * (`workflow_id`) are intentionally excluded.
 *
 * This endpoint has no pagination — the full list is always returned.  For a
 * production system with large numbers of videos, cursor-based pagination
 * would be added; for this demo the dataset is small enough that a full scan
 * is acceptable.
 *
 * @returns `200 { data: VideoResource[] }` — always returns an array (empty
 *   if no videos exist).
 *   `500 { error: string, detail?: string }` for unexpected D1 failures.
 *
 * @example
 * ```http
 * GET /api/videos
 *
 * → 200
 * { "data": [ { "id": "01960b1e-...", "filename": "lecture.mkv", "status": "complete", ... }, ... ] }
 * ```
 */
videosRouter.get("/", async (c) => {
  let results: VideoResource[];

  try {
    const stmt = await c.env.DB.prepare(
      `SELECT ${SAFE_COLUMNS} FROM videos ORDER BY created_at DESC`,
    ).all<VideoResource>();
    results = stmt.results;
  } catch (err) {
    return c.json(
      {
        error: "Failed to list videos",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  return c.json({ data: results });
});

// ---------------------------------------------------------------------------
// GET /:id — Get a single video by UUID
// ---------------------------------------------------------------------------

/**
 * Returns a single video record identified by its UUID primary key.
 *
 * Queries the D1 `videos` table for the given `id` and returns only the
 * client-safe columns.  Returns `404` if no row exists for the provided ID.
 *
 * @param id - UUID of the video (path parameter).
 *
 * @returns `200 { data: VideoResource }` when the video is found.
 *   `404 { error: "Video not found" }` when no record matches `id`.
 *   `500 { error: string, detail?: string }` for unexpected D1 failures.
 *
 * @example
 * ```http
 * GET /api/videos/01960b1e-4a7b-7d99-b90c-12e0f73c69d0
 *
 * → 200
 * { "data": { "id": "01960b1e-...", "filename": "lecture.mkv", "status": "complete", ... } }
 *
 * GET /api/videos/does-not-exist
 *
 * → 404
 * { "error": "Video not found" }
 * ```
 */
videosRouter.get("/:id", async (c) => {
  const { id } = c.req.param();

  let row: VideoResource | null;

  try {
    row = await c.env.DB.prepare(
      `SELECT ${SAFE_COLUMNS} FROM videos WHERE id = ?`,
    )
      .bind(id)
      .first<VideoResource>();
  } catch (err) {
    return c.json(
      {
        error: "Failed to retrieve video",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  if (row === null) {
    return c.json({ error: "Video not found" }, 404);
  }

  return c.json({ data: row });
});
