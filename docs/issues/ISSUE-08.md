# Issue 08 — Upload Initiation API

## Summary

Implement the two upload endpoints: `POST /api/videos` (register a new video and return a presigned upload URL) and `POST /api/videos/:id/process` (mark upload complete and start the Workflow). These are the write paths that drive the entire pipeline.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`
- `wrangler`

## Dependencies

- ISSUE-05 (Hono app with auth middleware)
- ISSUE-07 (presigned URL utility)

## Acceptance Criteria

- [ ] `src/api/upload.ts` exports a Hono router with two routes
- [ ] `POST /api/videos` accepts `{ filename: string }`, validates input, generates a UUID, inserts a D1 row with status `uploading`, generates a presigned PUT URL for `incoming/{id}.{ext}`, returns `{ data: { id, upload_url } }`
- [ ] `POST /api/videos/:id/process` looks up the video by ID, validates status is `uploading`, updates status to `processing`, creates a Workflow instance with `VideoWorkflowParams`, stores `workflow_id` in D1, returns `{ data: { id, status: "processing" } }`
- [ ] Both routes return `ApiError` responses for validation failures (400) and not-found (404)
- [ ] The upload router is mounted at `/api/videos` in `src/index.ts`
- [ ] UUIDs are generated with `crypto.randomUUID()` (not `Math.random()`)
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/api/upload.ts` | Added | POST /api/videos and POST /api/videos/:id/process |
| `src/index.ts` | Modified | Mount upload router |

## Technical Implementation

### `POST /api/videos`

1. Parse JSON body, extract `filename`
2. Validate `filename` is present and non-empty
3. Extract `originalFormat` from file extension (e.g., `"video.mkv"` → `"mkv"`)
4. Generate `id` with `crypto.randomUUID()`
5. Compute `r2IncomingKey` as `incoming/${id}.${originalFormat}`
6. Insert into D1: all required fields, status `uploading`
7. Generate presigned PUT URL for the R2 incoming key
8. Return `{ data: { id, upload_url } }`

### `POST /api/videos/:id/process`

1. Look up video in D1 by `id`
2. Return 404 if not found
3. Return 400 if status is not `uploading`
4. Create Workflow instance: `env.VIDEO_WORKFLOW.create({ params: { videoId, filename, originalFormat, r2IncomingKey } })`
5. Update D1: set `status = 'processing'`, `workflow_id = instance.id`
6. Return `{ data: { id, status: "processing" } }`

### Workflow Instance Creation

The `VIDEO_WORKFLOW` binding provides `.create()` which accepts params. The returned instance has an `.id` property that should be stored in the `workflow_id` column for later status lookups.

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `src/api/upload.ts` — uses `crypto.randomUUID()`, not `Math.random()`
3. Inspect `src/index.ts` — upload router is mounted

## Other Notes

The Workflow class itself doesn't exist yet (ISSUE-14). The `VIDEO_WORKFLOW.create()` call will fail at runtime until the Workflow is implemented, but the type-check must pass. At runtime, the Worker will return a 500 error if the Workflow binding is not available — this is expected until the full pipeline is wired.
