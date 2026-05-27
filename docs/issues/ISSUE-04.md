# Issue 04 — D1 Schema Migration

## Summary

Create the initial D1 migration SQL file that defines the `videos` table with all columns from the Data Model section of PLAN.md.

## Relevant Skills

- `cloudflare`
- `wrangler`

## Dependencies

- ISSUE-01 (project scaffolding — migrations directory)

## Acceptance Criteria

- [ ] `migrations/0001_init.sql` exists with a `CREATE TABLE IF NOT EXISTS videos` statement
- [ ] All columns from PLAN.md's Data Model section are present with correct types and constraints
- [ ] `id` is `TEXT PRIMARY KEY`
- [ ] `filename`, `original_format`, `status` are `TEXT NOT NULL`
- [ ] `status` has a `DEFAULT 'uploading'`
- [ ] `created_at` and `updated_at` are `TEXT NOT NULL` with `DEFAULT (datetime('now'))`
- [ ] All other columns (`workflow_id`, `r2_incoming_key`, `r2_video_key`, `r2_audio_key`, `r2_bw_key`, `stream_video_id`, `stream_url`, `error_message`) are nullable `TEXT`
- [ ] An index exists on `status` for efficient filtering
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `migrations/0001_init.sql` | Added | D1 schema: `videos` table with all columns and index |

## Technical Implementation

### SQL Schema

```sql
CREATE TABLE IF NOT EXISTS videos (
  id               TEXT PRIMARY KEY,
  filename         TEXT NOT NULL,
  original_format  TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'uploading',
  workflow_id      TEXT,
  r2_incoming_key  TEXT,
  r2_video_key     TEXT,
  r2_audio_key     TEXT,
  r2_bw_key        TEXT,
  stream_video_id  TEXT,
  stream_url       TEXT,
  error_message    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_videos_status ON videos (status);
```

### Valid Status Values

For reference (enforced in application code, not as a SQL constraint):
`uploading`, `processing`, `transcoding`, `extracting_audio`, `grayscaling`, `uploading_to_stream`, `complete`, `error`.

## Manual Tests

1. Inspect `migrations/0001_init.sql` — all 14 columns present, correct types, constraints match PLAN.md Data Model table
2. Run `npm run check` — passes

## Other Notes

D1 migrations are applied via `wrangler d1 migrations apply`. The `db:migrate:local` and `db:migrate:remote` scripts were wired in ISSUE-03. Actual migration execution happens when `npm start` or `npm run deploy` is run (via pre-scripts), which requires ISSUE-02's infrastructure to be provisioned first.
