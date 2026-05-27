-- Migration 0001: Initial schema
--
-- Creates the `videos` table that tracks every video through the processing
-- pipeline, from initial upload through transcoding, audio extraction,
-- grayscale conversion, and final upload to Cloudflare Stream.
--
-- Status lifecycle (enforced in application code, not as a SQL constraint):
--   uploading → processing → transcoding → extracting_audio
--   → grayscaling → uploading_to_stream → complete
--   Any step → error

CREATE TABLE IF NOT EXISTS videos (
  -- Primary key: UUID generated server-side (e.g. crypto.randomUUID())
  id               TEXT PRIMARY KEY,

  -- Original filename as provided by the browser (e.g. "my-video.mkv")
  filename         TEXT NOT NULL,

  -- File extension derived from the filename (e.g. "mkv", "mp4", "webm")
  original_format  TEXT NOT NULL,

  -- Current pipeline status; defaults to 'uploading' on row creation
  status           TEXT NOT NULL DEFAULT 'uploading',

  -- Cloudflare Workflows instance ID, set once the workflow is started
  workflow_id      TEXT,

  -- R2 object keys for each processing stage (null until that stage runs)
  r2_incoming_key  TEXT,  -- incoming/{id}.{ext}  — raw upload
  r2_video_key     TEXT,  -- video/{id}.mp4        — transcoded MP4
  r2_audio_key     TEXT,  -- audio/{id}.mp3        — extracted audio
  r2_bw_key        TEXT,  -- bwvideo/{id}.mp4      — grayscale video

  -- Cloudflare Stream identifiers (null until upload-to-stream step completes)
  stream_video_id  TEXT,
  stream_url       TEXT,

  -- Human-readable error details when status = 'error'
  error_message    TEXT,

  -- ISO 8601 timestamps stored as TEXT (SQLite has no native datetime type)
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index on status enables efficient filtering by pipeline stage.
-- The dashboard polls GET /api/videos frequently; this avoids full-table scans.
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos (status);
