/**
 * Video read and playback endpoints for the Video Processing Pipeline.
 *
 * This module exports a Hono sub-router that implements the read-path
 * endpoints consumed by the frontend dashboard:
 *
 * - `GET /` (mounted at `/api/videos`) — returns all video records ordered
 *   by `created_at DESC`.  Only exposes columns that are safe to share with
 *   the client; internal R2 keys and Workflow instance IDs are omitted.
 *
 * - `GET /:id` — returns a single video record by its UUID primary key, or
 *   `404` if no matching record exists.
 *
 * - `GET /:id/stream` — streams the grayscale MP4 directly from R2 to the
 *   browser.  Supports HTTP Range requests so browsers can seek within the
 *   video without re-downloading the entire file.  Returns `404` if the video
 *   has not yet been processed (no `r2_bw_key`).
 *
 * All routes require authentication (enforced by the parent app's middleware
 * before these handlers are invoked) and return the standard
 * `{ data: T }` / `{ error, detail? }` envelope, except for `GET /:id/stream`
 * which returns a raw `video/mp4` response.
 *
 * @module api/videos
 */

import type { AuthVariables } from "@adrianhall/cloudflare-auth";
import { Hono } from "hono";
import type { VideoResource } from "../types";

/** Hono application type that wires the generated `Env` bindings and auth variables. */
type AppEnv = { Bindings: Env; Variables: AuthVariables };

/**
 * SQL SELECT clause listing the D1 columns fetched for the client response.
 *
 * Explicitly excludes internal implementation details:
 * - `r2_incoming_key`, `r2_video_key`, `r2_audio_key`, `r2_bw_key` — storage
 *   topology that has no meaning to the frontend.
 * - `workflow_id` — internal Workflow instance handle.
 * - `stream_video_id`, `stream_url` — legacy Stream columns; always NULL after
 *   the migration to direct R2 playback (see DECISIONS.md ISSUE-18).
 *
 * `r2_bw_key` IS included here (aliased) so the streaming endpoint can check
 * whether the grayscale output exists without a second query.
 */
const VIDEO_COLUMNS =
  "id, filename, original_format, status, r2_bw_key, error_message, created_at, updated_at";

/** D1 row shape for the video columns selected above. */
interface VideoRow {
  id: string;
  filename: string;
  original_format: string;
  status: string;
  r2_bw_key: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Convert a raw D1 `VideoRow` into a `VideoResource` for the API response.
 *
 * Computes `play_url` from `r2_bw_key`: if the grayscale output exists in R2
 * the client can stream the video via the authenticated Worker endpoint.
 *
 * @param row - Raw row from the D1 `videos` table.
 * @returns A `VideoResource` safe for inclusion in the API response.
 */
function toVideoResource(row: VideoRow): VideoResource {
  return {
    id: row.id,
    filename: row.filename,
    original_format: row.original_format,
    status: row.status as VideoResource["status"],
    play_url: row.r2_bw_key ? `/api/videos/${row.id}/stream` : null,
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Hono sub-router for video read and playback endpoints.
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
 * Routes exposed:
 * - `GET /` — list all videos
 * - `GET /:id` — get a single video by UUID
 * - `GET /:id/stream` — stream the processed video from R2
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
 * `r2_video_key`, `r2_audio_key`) and the Workflow instance ID (`workflow_id`)
 * are intentionally excluded.  `play_url` is computed from `r2_bw_key`.
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
 * { "data": [ { "id": "01960b1e-...", "filename": "lecture.mkv", "status": "complete",
 *               "play_url": "/api/videos/01960b1e-.../stream", ... } ] }
 * ```
 */
videosRouter.get("/", async (c) => {
  let rows: VideoRow[];

  try {
    const stmt = await c.env.DB.prepare(
      `SELECT ${VIDEO_COLUMNS} FROM videos ORDER BY created_at DESC`,
    ).all<VideoRow>();
    rows = stmt.results;
  } catch (err) {
    return c.json(
      {
        error: "Failed to list videos",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  return c.json({ data: rows.map(toVideoResource) });
});

// ---------------------------------------------------------------------------
// GET /:id — Get a single video by UUID
// ---------------------------------------------------------------------------

/**
 * Returns a single video record identified by its UUID primary key.
 *
 * Queries the D1 `videos` table for the given `id` and returns only the
 * client-safe columns.  Returns `404` if no row exists for the provided ID.
 * `play_url` is computed from `r2_bw_key`.
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
 * { "data": { "id": "01960b1e-...", "status": "complete",
 *             "play_url": "/api/videos/01960b1e-.../stream", ... } }
 * ```
 */
videosRouter.get("/:id", async (c) => {
  const { id } = c.req.param();

  let row: VideoRow | null;

  try {
    row = await c.env.DB.prepare(
      `SELECT ${VIDEO_COLUMNS} FROM videos WHERE id = ?`,
    )
      .bind(id)
      .first<VideoRow>();
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

  return c.json({ data: toVideoResource(row) });
});

// ---------------------------------------------------------------------------
// GET /:id/stream — Stream the processed grayscale video from R2
// ---------------------------------------------------------------------------

/**
 * Streams the grayscale MP4 for a video directly from R2 to the browser.
 *
 * Uses the R2 Workers binding so the file body is streamed — not buffered —
 * through the Worker.  This keeps memory usage well within the 128 MB Worker
 * limit even for large video files.
 *
 * HTTP Range requests are forwarded to R2 natively by passing the incoming
 * `Range` header to `BUCKET.get()`.  This enables browsers to seek within
 * the video without downloading the entire file first.  A `206 Partial Content`
 * response is returned for range requests; `200 OK` for full-file requests.
 *
 * The `Cache-Control: public, max-age=3600` header allows the browser (and
 * any intervening CDN) to cache the video for up to one hour.
 *
 * @param id - UUID of the video (path parameter).
 *
 * @returns `200 video/mp4` or `206 video/mp4` (partial) with the video body.
 *   `404 { error }` if the video does not exist or has not yet been processed
 *   (i.e. `r2_bw_key` is NULL — the grayscale step has not completed).
 *   `500 { error }` for unexpected storage failures.
 *
 * @example
 * ```html
 * <!-- Frontend — direct src reference, works with range requests for seeking -->
 * <video src="/api/videos/01960b1e-4a7b-7d99-b90c-12e0f73c69d0/stream" controls />
 * ```
 */
videosRouter.get("/:id/stream", async (c) => {
  const { id } = c.req.param();

  // Look up the video.  We only need r2_bw_key — the key under which the
  // grayscale MP4 is stored — so we use a minimal projection.
  let row: { r2_bw_key: string | null } | null;
  try {
    row = await c.env.DB.prepare("SELECT r2_bw_key FROM videos WHERE id = ?")
      .bind(id)
      .first<{ r2_bw_key: string | null }>();
  } catch (err) {
    return c.json(
      {
        error: "Failed to retrieve video record",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  if (!row) {
    return c.json({ error: "Video not found" }, 404);
  }

  if (!row.r2_bw_key) {
    return c.json(
      { error: "Video is not yet ready for playback — processing in progress" },
      404,
    );
  }

  // Forward the browser's Range header to R2 so seeking works without
  // re-downloading the whole file.  Passing the Headers object lets R2 parse
  // the Range syntax (e.g. "bytes=0-1023") and return the matching byte range.
  const rangeHeader = c.req.header("range");
  const obj = await c.env.BUCKET.get(
    row.r2_bw_key,
    rangeHeader ? { range: c.req.raw.headers } : undefined,
  );

  if (!obj) {
    return c.json({ error: "Video file not found in storage" }, 404);
  }

  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
  });

  let status = 200;

  if (rangeHeader && obj.range) {
    // Build the Content-Range response header from the range R2 actually served.
    const r = obj.range;
    if ("offset" in r) {
      const start = r.offset ?? 0;
      const end = r.length ? start + r.length - 1 : obj.size - 1;
      headers.set("Content-Range", `bytes ${start}-${end}/${obj.size}`);
      headers.set("Content-Length", String(end - start + 1));
      status = 206;
    }
  } else {
    headers.set("Content-Length", String(obj.size));
  }

  return new Response(obj.body, { status, headers });
});
