/**
 * All video API endpoints for the Video Processing Pipeline.
 *
 * This module exports a single Hono sub-router that owns every route under
 * `/api/videos`.  Keeping all routes in one file removes any ambiguity about
 * which sub-router handles a given path, and guarantees that Hono evaluates
 * them in the correct order — most-specific first.
 *
 * ## Route registration order (IMPORTANT)
 *
 * Hono evaluates routes in registration order.  A wildcard parameter like
 * `/:id` will shadow any more-specific route registered after it (e.g.
 * `/:id/stream`).  For this reason the routes are registered here with
 * literal-suffix routes before the bare `/:id` catch:
 *
 * ```
 * POST  /                  ← register new video
 * POST  /:id/process       ← start workflow
 * GET   /                  ← list all videos
 * GET   /:id/status        ← workflow status   (specific before /:id)
 * GET   /:id/stream        ← R2 video stream   (specific before /:id)
 * GET   /:id               ← single video      (must be LAST /:id route)
 * ```
 *
 * @module api/videos
 */

import type { AuthVariables } from "@adrianhall/cloudflare-auth";
import { Hono } from "hono";
import { generatePresignedUrl } from "../lib/presigned";
import type {
  UploadInitResponse,
  VideoResource,
  VideoWorkflowParams,
} from "../types";

/** Hono application type that wires the generated `Env` bindings and auth variables. */
type AppEnv = { Bindings: Env; Variables: AuthVariables };

// ---------------------------------------------------------------------------
// Shared column list
// ---------------------------------------------------------------------------

/**
 * SQL SELECT clause for the columns included in the `VideoResource` API
 * response.
 *
 * `r2_bw_key` is selected so `toVideoResource` can compute `play_url`
 * without a second query.  Internal R2 keys for intermediate files
 * (`r2_incoming_key`, `r2_video_key`, `r2_audio_key`), the workflow instance
 * ID, and the legacy Stream columns (`stream_video_id`, `stream_url`) are all
 * excluded from client responses.
 */
const VIDEO_COLUMNS =
  "id, filename, original_format, status, r2_bw_key, error_message, created_at, updated_at";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/**
 * Raw D1 row returned by `VIDEO_COLUMNS` queries.
 * Includes `r2_bw_key` for `play_url` computation — never sent to clients
 * directly; always converted through `toVideoResource`.
 */
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
 * Minimal D1 row shape used by the upload initiation endpoint.
 * Only the columns needed by `POST /` and `POST /:id/process`.
 */
interface VideoUploadRow {
  /** UUID primary key. */
  id: string;
  /** Original filename as uploaded by the browser. */
  filename: string;
  /** File extension without the leading dot (e.g. `"mkv"`). */
  original_format: string;
  /** Current pipeline status string. */
  status: string;
  /** R2 key for the raw incoming file (e.g. `"incoming/{id}.mkv"`). */
  r2_incoming_key: string;
}

/**
 * Minimal D1 row shape used by the workflow status endpoint.
 * Only the columns needed by `GET /:id/status`.
 */
interface VideoStatusRow {
  id: string;
  status: string;
  workflow_id: string | null;
}

/**
 * Response payload for `GET /:id/status` — D1 pipeline status combined with
 * the live Cloudflare Workflow instance status.
 */
interface VideoStatusResponse {
  id: string;
  status: string;
  workflow_status: InstanceStatus | null;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Convert a raw `VideoRow` from D1 into a `VideoResource` for API responses.
 *
 * Computes `play_url` from `r2_bw_key`: non-null means the grayscale step has
 * written output to R2 and the video is streamable via `GET /:id/stream`.
 *
 * @param row - Raw D1 row selected with `VIDEO_COLUMNS`.
 * @returns Client-safe `VideoResource` with `play_url` populated or `null`.
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

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Hono sub-router that owns every route under `/api/videos`.
 *
 * Mount once in the root app:
 * ```ts
 * app.route("/api/videos", videosRouter);
 * ```
 */
export const videosRouter = new Hono<AppEnv>();

// ===========================================================================
// POST / — Register a new video and return a presigned R2 PUT URL
// ===========================================================================

/**
 * Registers a new video upload and returns a presigned R2 PUT URL.
 *
 * The client must PUT the file body directly to `upload_url` (bypassing the
 * Worker's 100 MB body limit) and then call `POST /:id/process`.
 *
 * @returns `200 { data: { id, upload_url } }` on success.
 *   `400 { error }` if `filename` is missing or empty.
 *   `500 { error, detail? }` for unexpected failures.
 */
videosRouter.post("/", async (c) => {
  let body: { filename?: unknown };
  try {
    body = await c.req.json<{ filename?: unknown }>();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const { filename } = body;
  if (typeof filename !== "string" || filename.trim() === "") {
    return c.json({ error: "Missing required field: filename" }, 400);
  }

  const trimmedFilename = filename.trim();
  const dotIndex = trimmedFilename.lastIndexOf(".");
  const originalFormat =
    dotIndex !== -1 && dotIndex < trimmedFilename.length - 1
      ? trimmedFilename.slice(dotIndex + 1).toLowerCase()
      : "bin";

  const id = crypto.randomUUID();
  const r2IncomingKey = `incoming/${id}.${originalFormat}`;
  const now = new Date().toISOString();

  try {
    await c.env.DB.prepare(
      `INSERT INTO videos
         (id, filename, original_format, status, r2_incoming_key, created_at, updated_at)
       VALUES (?, ?, ?, 'uploading', ?, ?, ?)`,
    )
      .bind(id, trimmedFilename, originalFormat, r2IncomingKey, now, now)
      .run();
  } catch (err) {
    return c.json(
      {
        error: "Failed to create video record",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  let uploadUrl: string;
  try {
    uploadUrl = await generatePresignedUrl(
      c.env,
      c.env.R2_BUCKET_NAME,
      r2IncomingKey,
      "PUT",
    );
  } catch (err) {
    return c.json(
      {
        error: "Failed to generate upload URL",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  const responseData: UploadInitResponse = { id, upload_url: uploadUrl };
  return c.json({ data: responseData }, 200);
});

// ===========================================================================
// POST /:id/process — Mark upload complete and start the Workflow
// ===========================================================================

/**
 * Marks a video upload as complete and creates a `VideoProcessingWorkflow`
 * instance.  Called by the browser after the direct R2 PUT upload finishes.
 *
 * @returns `200 { data: { id, status: "processing" } }` on success.
 *   `404 { error }` if the video ID does not exist.
 *   `400 { error }` if the video is not in `uploading` status.
 *   `500 { error, detail? }` for unexpected failures.
 */
videosRouter.post("/:id/process", async (c) => {
  const { id } = c.req.param();

  let video: VideoUploadRow | null;
  try {
    video = await c.env.DB.prepare(
      "SELECT id, filename, original_format, status, r2_incoming_key FROM videos WHERE id = ?",
    )
      .bind(id)
      .first<VideoUploadRow>();
  } catch (err) {
    return c.json(
      {
        error: "Failed to look up video",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  if (video === null) {
    return c.json({ error: "Video not found" }, 404);
  }

  if (video.status !== "uploading") {
    return c.json(
      {
        error: `Video cannot be processed: expected status "uploading" but got "${video.status}"`,
      },
      400,
    );
  }

  const params: VideoWorkflowParams = {
    videoId: video.id,
    filename: video.filename,
    originalFormat: video.original_format,
    r2IncomingKey: video.r2_incoming_key,
  };

  let workflowId: string;
  try {
    const instance = await c.env.VIDEO_WORKFLOW.create({ id, params });
    workflowId = instance.id;
  } catch (err) {
    return c.json(
      {
        error: "Failed to create workflow instance",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      "UPDATE videos SET status = 'processing', workflow_id = ?, updated_at = ? WHERE id = ?",
    )
      .bind(workflowId, now, id)
      .run();
  } catch (err) {
    return c.json(
      {
        error: "Failed to update video status",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  return c.json({ data: { id, status: "processing" as const } }, 200);
});

// ===========================================================================
// GET / — List all videos
// ===========================================================================

/**
 * Returns all video records ordered by creation time (newest first).
 *
 * @returns `200 { data: VideoResource[] }` (empty array if no videos).
 *   `500 { error, detail? }` for unexpected D1 failures.
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

// ===========================================================================
// GET /:id/status — Combined D1 + Workflow instance status
// ===========================================================================
// IMPORTANT: Registered BEFORE GET /:id to avoid the parameter shadowing
// routes that have a literal suffix (e.g. /status, /stream).

/**
 * Returns the current pipeline status for a video, combining the D1 record
 * status with the live Cloudflare Workflow instance status.
 *
 * @returns `200 { data: VideoStatusResponse }` when found.
 *   `404 { error }` when no video record matches `id`.
 *   `400 { error }` when `workflow_id` is null (upload not yet processed).
 *   `500 { error, detail? }` for unexpected failures.
 */
videosRouter.get("/:id/status", async (c) => {
  const { id } = c.req.param();

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

  if (video === null) {
    return c.json({ error: "Video not found" }, 404);
  }

  if (video.workflow_id === null) {
    return c.json({ error: "Workflow not started for this video" }, 400);
  }

  let workflowStatus: InstanceStatus | null = null;
  try {
    const instance = await c.env.VIDEO_WORKFLOW.get(video.workflow_id);
    workflowStatus = await instance.status();
  } catch {
    workflowStatus = null;
  }

  const responseData: VideoStatusResponse = {
    id: video.id,
    status: video.status,
    workflow_status: workflowStatus,
  };
  return c.json({ data: responseData });
});

// ===========================================================================
// GET /:id/stream — Stream the processed grayscale video from R2
// ===========================================================================
// IMPORTANT: Registered BEFORE GET /:id to avoid the parameter shadowing
// routes that have a literal suffix.

/**
 * Streams the grayscale MP4 for a video directly from R2 to the browser.
 *
 * Uses the R2 Workers binding so the file body is streamed (not buffered)
 * through the Worker, keeping memory usage well within the 128 MB limit.
 * HTTP Range requests are forwarded to R2 natively for browser seek support.
 *
 * @returns `200 video/mp4` or `206 Partial Content` with the video body.
 *   `404 { error }` if the video does not exist, `r2_bw_key` is not set, or
 *   the R2 object is missing.
 *   `500 { error, detail? }` for unexpected failures.
 *
 * @example
 * ```html
 * <video src="/api/videos/01960b1e-.../stream" controls />
 * ```
 */
videosRouter.get("/:id/stream", async (c) => {
  const { id } = c.req.param();
  console.log(`[stream] GET /:id/stream — id=${id}`);

  // ── 1. Look up r2_bw_key in D1 ───────────────────────────────────────────
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

  console.log(`[stream] DB row=${JSON.stringify(row)}`);

  if (!row) {
    console.log(`[stream] 404 — video id=${id} not found in DB`);
    return c.json({ error: "Video not found" }, 404);
  }

  if (!row.r2_bw_key) {
    console.log(
      `[stream] 404 — r2_bw_key null for id=${id} (processing not yet complete)`,
    );
    return c.json(
      { error: "Video is not yet ready for playback — processing in progress" },
      404,
    );
  }

  // ── 2. Generate a presigned GET URL and fetch directly from R2 ────────────
  //
  // We use a presigned URL + fetch rather than the BUCKET binding because in
  // `wrangler dev` (local mode) the BUCKET binding reads from wrangler's local
  // R2 simulation, while the ffmpeg container writes processed files to the
  // REAL R2 bucket via presigned PUT URLs.  These two storage locations are
  // separate, so the binding would always return null for files the container
  // uploaded.  Using the S3-compatible presigned URL bypasses the local
  // simulation and reaches the real bucket in both dev and production.
  //
  // The Worker's fetch() goes directly to the internet (not through the Docker
  // cloudflare/proxy-everything sidecar), so there is no SSL-interception
  // issue here — that issue was specific to the container's network stack.
  console.log(`[stream] generating presigned GET URL for key=${row.r2_bw_key}`);

  let presignedUrl: string;
  try {
    presignedUrl = await generatePresignedUrl(
      c.env,
      c.env.R2_BUCKET_NAME,
      row.r2_bw_key,
      "GET",
      3600,
    );
  } catch (err) {
    return c.json(
      {
        error: "Failed to generate playback URL",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  // ── 3. Forward the request to R2, passing any Range header for seek ───────
  const rangeHeader = c.req.header("range");
  const fetchInit: RequestInit = rangeHeader
    ? { headers: { Range: rangeHeader } }
    : {};

  console.log(
    `[stream] fetching from real R2 (range=${rangeHeader ?? "none"})`,
  );

  let r2Resp: Response;
  try {
    r2Resp = await fetch(presignedUrl, fetchInit);
  } catch (err) {
    return c.json(
      {
        error: "Failed to fetch video from storage",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  console.log(
    `[stream] R2 response — HTTP ${r2Resp.status}` +
      ` Content-Length=${r2Resp.headers.get("Content-Length") ?? "?"}`,
  );

  if (r2Resp.status === 404 || r2Resp.status === 403) {
    console.log(
      `[stream] 404 — R2 object not accessible for key=${row.r2_bw_key} (R2 status=${r2Resp.status})`,
    );
    return c.json({ error: "Video file not found in storage" }, 404);
  }

  if (!r2Resp.ok && r2Resp.status !== 206) {
    return c.json(
      { error: `Unexpected R2 response: HTTP ${r2Resp.status}` },
      502,
    );
  }

  // ── 4. Build the response, passing through R2 range/length headers ────────
  const responseHeaders = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
  });

  const contentLength = r2Resp.headers.get("Content-Length");
  if (contentLength) responseHeaders.set("Content-Length", contentLength);

  const contentRange = r2Resp.headers.get("Content-Range");
  if (contentRange) responseHeaders.set("Content-Range", contentRange);

  return new Response(r2Resp.body, {
    status: r2Resp.status, // 200 or 206
    headers: responseHeaders,
  });
});

// ===========================================================================
// GET /:id — Get a single video by UUID
// ===========================================================================
// IMPORTANT: Registered LAST among /:id routes so the more-specific
// /:id/status and /:id/stream handlers are tried first.

/**
 * Returns a single video record identified by its UUID primary key.
 *
 * @returns `200 { data: VideoResource }` when found.
 *   `404 { error }` when no record matches `id`.
 *   `500 { error, detail? }` for unexpected D1 failures.
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
