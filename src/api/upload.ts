/**
 * Upload initiation routes for the Video Processing Pipeline.
 *
 * This module exports a Hono sub-router that implements the two write-path
 * endpoints that drive the entire pipeline:
 *
 * - `POST /` (mounted at `/api/videos`) — registers a new video record in D1,
 *   generates a presigned R2 PUT URL for direct browser-to-R2 upload, and
 *   returns the URL to the client.  The Worker never proxies the file body,
 *   which avoids the 100 MB Workers body limit.
 *
 * - `POST /:id/process` — called after the browser finishes the direct R2
 *   upload.  Validates the video exists and has `uploading` status, creates a
 *   `VideoProcessingWorkflow` instance, stores the workflow ID in D1, and
 *   transitions the record to `processing`.
 *
 * Both routes require authentication (enforced by the parent app's middleware
 * before these handlers are invoked) and return the standard
 * `{ data: T }` / `{ error, detail? }` envelope.
 *
 * @module api/upload
 */

import type { AuthVariables } from "@adrianhall/cloudflare-auth";
import { Hono } from "hono";
import { generatePresignedUrl } from "../lib/presigned";
import type { UploadInitResponse, VideoWorkflowParams } from "../types";

/** Hono application type that wires the generated `Env` bindings and auth variables. */
type AppEnv = { Bindings: Env; Variables: AuthVariables };

/**
 * Row shape returned by D1 for a single video lookup.
 *
 * Only the columns needed by this module are selected — `id`, `status`, and
 * the fields forwarded to the Workflow on creation.
 */
interface VideoRow {
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
 * Hono sub-router for upload initiation endpoints.
 *
 * Mount this router into the root app at `/api/videos`:
 *
 * ```ts
 * import { uploadRouter } from "./api/upload";
 * app.route("/api/videos", uploadRouter);
 * ```
 *
 * The router exposes two routes:
 * - `POST /` — register a video and return a presigned upload URL
 * - `POST /:id/process` — mark upload complete and start the Workflow
 */
export const uploadRouter = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// POST / — Register a new video and return a presigned R2 PUT URL
// ---------------------------------------------------------------------------

/**
 * Registers a new video upload and returns a presigned R2 PUT URL.
 *
 * ## Steps
 * 1. Parse the JSON body and extract `filename`.
 * 2. Validate that `filename` is present and non-empty.
 * 3. Extract the file extension from `filename` as `originalFormat`.
 * 4. Generate a UUID with `crypto.randomUUID()`.
 * 5. Compute the R2 key: `incoming/{id}.{ext}`.
 * 6. Insert a new row into D1 with `status = "uploading"`.
 * 7. Generate a presigned PUT URL for the incoming R2 key.
 * 8. Return `{ data: { id, upload_url } }`.
 *
 * @returns `200 { data: { id: string, upload_url: string } }` on success.
 *   `400 { error: string }` if `filename` is missing or empty.
 *   `500 { error: string, detail?: string }` for unexpected failures.
 *
 * @example
 * ```http
 * POST /api/videos
 * Content-Type: application/json
 *
 * { "filename": "lecture.mkv" }
 *
 * → 200
 * { "data": { "id": "01960b1e-...", "upload_url": "https://..." } }
 * ```
 */
uploadRouter.post("/", async (c) => {
  // 1. Parse body
  let body: { filename?: unknown };
  try {
    body = await c.req.json<{ filename?: unknown }>();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  // 2. Validate filename
  const { filename } = body;
  if (typeof filename !== "string" || filename.trim() === "") {
    return c.json({ error: "Missing required field: filename" }, 400);
  }

  const trimmedFilename = filename.trim();

  // 3. Extract extension — everything after the last ".", lower-cased.
  //    If the filename has no extension, fall back to "bin" as a safe default.
  const dotIndex = trimmedFilename.lastIndexOf(".");
  const originalFormat =
    dotIndex !== -1 && dotIndex < trimmedFilename.length - 1
      ? trimmedFilename.slice(dotIndex + 1).toLowerCase()
      : "bin";

  // 4. Generate a cryptographically random UUID — never Math.random()
  const id = crypto.randomUUID();

  // 5. Build the R2 incoming key
  const r2IncomingKey = `incoming/${id}.${originalFormat}`;

  // 6. Insert into D1
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

  // 7. Generate presigned PUT URL for direct browser-to-R2 upload
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

  // 8. Return the envelope
  const responseData: UploadInitResponse = { id, upload_url: uploadUrl };
  return c.json({ data: responseData }, 200);
});

// ---------------------------------------------------------------------------
// POST /:id/process — Mark upload complete and start the Workflow
// ---------------------------------------------------------------------------

/**
 * Marks a video upload as complete and creates a `VideoProcessingWorkflow` instance.
 *
 * This endpoint is called by the browser after it has finished the direct R2
 * PUT upload.  It transitions the video from `uploading` to `processing` and
 * kicks off the Cloudflare Workflow that handles transcoding, audio extraction,
 * grayscale conversion, and Stream upload.
 *
 * ## Steps
 * 1. Look up the video row in D1 by `id`.
 * 2. Return `404` if the video does not exist.
 * 3. Return `400` if the current status is not `uploading` (idempotency guard).
 * 4. Create a Workflow instance via `env.VIDEO_WORKFLOW.create()`, passing
 *    `VideoWorkflowParams` as the payload.
 * 5. Update D1: set `status = "processing"` and store `workflow_id`.
 * 6. Return `{ data: { id, status: "processing" } }`.
 *
 * @returns `200 { data: { id: string, status: "processing" } }` on success.
 *   `404 { error: string }` if the video ID does not exist.
 *   `400 { error: string }` if the video is not in `uploading` status.
 *   `500 { error: string, detail?: string }` for unexpected failures.
 *
 * @example
 * ```http
 * POST /api/videos/01960b1e-4a7b-7d99-b90c-12e0f73c69d0/process
 *
 * → 200
 * { "data": { "id": "01960b1e-...", "status": "processing" } }
 * ```
 */
uploadRouter.post("/:id/process", async (c) => {
  const { id } = c.req.param();

  // 1. Look up the video in D1
  let video: VideoRow | null;
  try {
    video = await c.env.DB.prepare(
      `SELECT id, filename, original_format, status, r2_incoming_key
         FROM videos
        WHERE id = ?`,
    )
      .bind(id)
      .first<VideoRow>();
  } catch (err) {
    return c.json(
      {
        error: "Failed to look up video",
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }

  // 2. 404 if not found
  if (video === null) {
    return c.json({ error: "Video not found" }, 404);
  }

  // 3. 400 if not in uploading status
  if (video.status !== "uploading") {
    return c.json(
      {
        error: `Video cannot be processed: expected status "uploading" but got "${video.status}"`,
      },
      400,
    );
  }

  // 4. Create the Workflow instance
  const params: VideoWorkflowParams = {
    videoId: video.id,
    filename: video.filename,
    originalFormat: video.original_format,
    r2IncomingKey: video.r2_incoming_key,
  };

  let workflowId: string;
  try {
    // Use the video ID as the workflow instance ID so each video maps to
    // exactly one workflow instance, making lookups trivial.
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

  // 5. Update D1 — transition to processing and record the workflow ID
  const now = new Date().toISOString();
  try {
    await c.env.DB.prepare(
      `UPDATE videos
          SET status = 'processing', workflow_id = ?, updated_at = ?
        WHERE id = ?`,
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

  // 6. Return success envelope
  return c.json({ data: { id, status: "processing" as const } }, 200);
});
