# Issue 10 — Workflow Status API

## Summary

Implement `GET /api/videos/:id/status` which returns the Workflow instance status for a given video. This is consumed by the frontend's polling mechanism to show real-time progress.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`

## Dependencies

- ISSUE-05 (Hono app with auth middleware)

## Acceptance Criteria

- [ ] `src/api/status.ts` exports a Hono router with one route
- [ ] `GET /api/videos/:id/status` looks up the video's `workflow_id` in D1, then queries the Workflow instance status via `env.VIDEO_WORKFLOW.get(workflowId).status()`
- [ ] Returns `{ data: { id, status, workflow_status } }` where `status` is from D1 and `workflow_status` is the Workflow instance's status object
- [ ] Returns 404 if video not found, 400 if no `workflow_id` exists (upload not yet triggered)
- [ ] The status router is mounted in `src/index.ts`
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/api/status.ts` | Added | GET /api/videos/:id/status |
| `src/index.ts` | Modified | Mount status router |

## Technical Implementation

### `GET /api/videos/:id/status`

1. Query D1 for the video by ID (SELECT `id`, `status`, `workflow_id`)
2. Return 404 if not found
3. Return 400 if `workflow_id` is null (workflow not started)
4. Get workflow instance: `const instance = await c.env.VIDEO_WORKFLOW.get(video.workflow_id)`
5. Get instance status: `const workflowStatus = await instance.status()`
6. Return combined response: `{ data: { id, status, workflow_status: workflowStatus } }`

### Error Handling

Wrap the workflow status call in a try-catch. If the workflow instance is not found (e.g., it was cleaned up), return a degraded response with only the D1 status and `workflow_status: null`.

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `src/api/status.ts` — handles missing video (404) and missing workflow_id (400) cases

## Other Notes

The workflow instance `.status()` method returns a structured object with step-level progress. The exact shape depends on the Cloudflare Workflows runtime. The frontend will parse this to show step-level progress indicators.
