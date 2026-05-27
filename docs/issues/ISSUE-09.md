# Issue 09 — Video List and Detail API

## Summary

Implement the read endpoints: `GET /api/videos` (list all videos) and `GET /api/videos/:id` (get a single video). These are the read paths consumed by the frontend dashboard.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`

## Dependencies

- ISSUE-05 (Hono app with auth middleware)

## Acceptance Criteria

- [ ] `src/api/videos.ts` exports a Hono router with two routes
- [ ] `GET /api/videos` queries D1 for all videos ordered by `created_at DESC`, returns `{ data: VideoResource[] }`
- [ ] `GET /api/videos/:id` queries D1 for a single video by ID, returns `{ data: VideoResource }` or `{ error: "Video not found" }` with 404
- [ ] Response shape matches the `VideoResource` type from `src/types.ts` (only expose safe columns — not internal R2 keys)
- [ ] The videos router is mounted in `src/index.ts`
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/api/videos.ts` | Added | GET /api/videos and GET /api/videos/:id |
| `src/index.ts` | Modified | Mount videos router |

## Technical Implementation

### `GET /api/videos`

```typescript
const { results } = await c.env.DB.prepare(
  'SELECT id, filename, original_format, status, stream_url, error_message, created_at, updated_at FROM videos ORDER BY created_at DESC'
).all();
return c.json({ data: results });
```

Only select columns that the frontend needs. Do not expose `r2_incoming_key`, `r2_video_key`, `r2_audio_key`, `r2_bw_key`, or `workflow_id` — these are internal implementation details.

### `GET /api/videos/:id`

```typescript
const row = await c.env.DB.prepare(
  'SELECT id, filename, original_format, status, stream_url, error_message, created_at, updated_at FROM videos WHERE id = ?'
).bind(c.req.param('id')).first();

if (!row) return c.json({ error: "Video not found" }, 404);
return c.json({ data: row });
```

### Router Mounting

Mount as a separate router in `src/index.ts`. Since upload routes (ISSUE-08) are also under `/api/videos`, coordinate the mounting so POST routes and GET routes don't conflict. One approach: use a single combined router, or mount both at the same path prefix with different HTTP methods.

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `src/api/videos.ts` — only safe columns are selected (no R2 keys or workflow_id)

## Other Notes

The list endpoint has no pagination for this demo. For a production system, cursor-based pagination would be needed. Keeping it simple per the "blog demo" design decision.
