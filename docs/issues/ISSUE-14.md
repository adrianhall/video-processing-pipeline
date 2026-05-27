# Issue 14 — Workflow: Scaffold and Register Step

## Summary

Create the `VideoProcessingWorkflow` class with the overall structure and the first step (register). This is the core of the project — the blog article's star. The class should be heavily commented and follow a clear linear pattern. Subsequent issues (15–18) add the remaining steps.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`
- `wrangler`

## Dependencies

- ISSUE-03 (wrangler template with `workflows` binding)
- ISSUE-04 (D1 schema — `videos` table)

## Acceptance Criteria

- [ ] `src/workflow.ts` exports `VideoProcessingWorkflow` extending `WorkflowEntrypoint<Env, VideoWorkflowParams>`
- [ ] The `run()` method contains Step 1 (register) and placeholder comments for Steps 2–6
- [ ] Step 1 (`register`): updates the video's status to `processing` in D1
- [ ] The class has a top-level JSDoc block explaining what the workflow does (educational — this is blog example code)
- [ ] Each step has a clear comment explaining its purpose
- [ ] Error handling wrapper: a try-catch around the entire run body that marks the video as `error` in D1 on unhandled failures
- [ ] The workflow class is re-exported from `src/index.ts`
- [ ] The `class_name` matches `VideoProcessingWorkflow` — consistent with `wrangler.jsonc.tpl`
- [ ] `scripts/get-dev-token.ts` is created — prints a signed dev JWT to stdout
- [ ] `scripts/smoke-test.sh` is created — authenticated end-to-end smoke test covering ISSUE-05 through ISSUE-14 (see Smoke Test Script below)
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/workflow.ts` | Modified | VideoProcessingWorkflow class with register step and step placeholders |
| `src/index.ts` | Modified | Re-export VideoProcessingWorkflow (already done in ISSUE-06 stub; confirm still correct) |
| `scripts/get-dev-token.ts` | Added | Prints a `signDevJwt()` token to stdout for use in shell scripts |
| `scripts/smoke-test.sh` | Added | Authenticated curl-based smoke test for all API routes |

## Technical Implementation

### Workflow Structure

```typescript
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

/**
 * VideoProcessingWorkflow orchestrates multi-step video processing.
 *
 * Each step is independently retriable. The workflow:
 * 1. Registers the video in D1 (status → processing)
 * 2. Transcodes to MP4 (if needed)
 * 3. Extracts audio to MP3
 * 4. Creates a grayscale version
 * 5. Uploads the grayscale video to Cloudflare Stream
 * 6. Finalizes: updates D1, cleans up R2
 */
export class VideoProcessingWorkflow extends WorkflowEntrypoint<Env, VideoWorkflowParams> {
  async run(event: WorkflowEvent<VideoWorkflowParams>, step: WorkflowStep) {
    const { videoId, filename, originalFormat, r2IncomingKey } = event.payload;

    try {
      // Step 1: Register — mark video as processing in D1
      await step.do('register', async () => {
        await this.env.DB.prepare(
          'UPDATE videos SET status = ?, updated_at = ? WHERE id = ?'
        ).bind('processing', new Date().toISOString(), videoId).run();
      });

      // Step 2: Transcode to MP4 (ISSUE-15)
      // Step 3: Extract audio (ISSUE-16)
      // Step 4: Grayscale (ISSUE-17)
      // Step 5: Upload to Stream (ISSUE-18)
      // Step 6: Finalize (ISSUE-18)

    } catch (err) {
      // Mark video as failed in D1
      await step.do('mark-error', async () => {
        await this.env.DB.prepare(
          'UPDATE videos SET status = ?, error_message = ?, updated_at = ? WHERE id = ?'
        ).bind('error', String(err), new Date().toISOString(), videoId).run();
      });
      throw err;
    }
  }
}
```

### Export from index.ts

```typescript
export { VideoProcessingWorkflow } from "./workflow";
```

This is required for Wrangler to find the class referenced in the `workflows` binding.

## Smoke Test Script

ISSUE-05 through ISSUE-14 accumulate API routes that cannot be smoke-tested with a bare `curl`
because all `/api/` paths require authentication. Manually copying a `CF_Authorization` cookie
from a browser after the `developerAuthentication` PIN flow is error-prone and non-repeatable.

The solution is a small helper that uses `signDevJwt()` from `@adrianhall/cloudflare-auth` to
mint a valid dev JWT, then passes it as the `cf-access-jwt-assertion` header — exactly what
`developerAuthentication` accepts in local dev mode.

### `scripts/get-dev-token.ts`

Prints a dev JWT to stdout. Used by `smoke-test.sh` to capture the token into a shell variable.

```typescript
import { signDevJwt } from "@adrianhall/cloudflare-auth";

// Print the token — consumed by smoke-test.sh via TOKEN=$(tsx scripts/get-dev-token.ts)
console.log(await signDevJwt("smoke@example.com"));
```

### `scripts/smoke-test.sh`

Assumes `wrangler dev` is already running on `http://localhost:8787` with a local D1 database.
Run with `bash scripts/smoke-test.sh`.

The script should cover the following checks in order, stopping on the first failure:

| # | Check | Expected |
|---|-------|----------|
| 1 | `GET /api/version` — no auth | `200 {"version":"1.0.0"}` |
| 2 | `POST /api/videos` — no auth | `302` redirect to `/_auth/login` |
| 3 | `POST /api/videos` — auth, missing `filename` | `400 {"error":...}` |
| 4 | `POST /api/videos` — auth, `filename: "smoke.mkv"` | `200 {"data":{"id":"<uuid>","upload_url":"https://..."}}` |
| 5 | `PUT <upload_url>` — upload a 1-byte test file directly to R2 | `200` (R2 presigned PUT) |
| 6 | `POST /api/videos/:id/process` — auth | `200 {"data":{"id":"...","status":"processing"}}` |
| 7 | `POST /api/videos/:id/process` again (already processing) | `400 {"error":...}` (status guard) |
| 8 | `GET /api/videos` — auth | `200 {"data":[...]}` containing the new video |
| 9 | `GET /api/videos/:id` — auth | `200 {"data":{...}}` with `status: "processing"` or later |
| 10 | `GET /api/videos/nonexistent-id` — auth | `404 {"error":"Video not found"}` |
| 11 | `GET /api/videos/:id/status` — auth | `200 {"data":{...}}` with workflow instance status |

Suggested implementation pattern:

```bash
#!/usr/bin/env bash
set -euo pipefail

BASE="http://localhost:8787"
TOKEN=$(npx tsx scripts/get-dev-token.ts)
AUTH_HEADER="cf-access-jwt-assertion: $TOKEN"

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; exit 1; }

check_status() {
  local label=$1 expected=$2 actual=$3
  [ "$actual" = "$expected" ] && pass "$label (HTTP $actual)" || fail "$label — expected $expected, got $actual"
}

echo "=== Smoke Tests ==="

# 1. Public version endpoint
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/version")
check_status "GET /api/version (no auth)" "200" "$status"

# 2. Protected endpoint without auth — expect redirect
status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos")
check_status "POST /api/videos (no auth)" "302" "$status"

# 3. Missing filename — expect 400
status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" -d '{}')
check_status "POST /api/videos (missing filename)" "400" "$status"

# 4. Valid POST — capture id and upload_url
response=$(curl -sf -X POST "$BASE/api/videos" \
  -H "$AUTH_HEADER" -H "Content-Type: application/json" \
  -d '{"filename":"smoke.mkv"}')
VIDEO_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
UPLOAD_URL=$(echo "$response" | grep -o '"upload_url":"[^"]*"' | cut -d'"' -f4)
[ -n "$VIDEO_ID" ] && pass "POST /api/videos — got id: $VIDEO_ID" || fail "POST /api/videos — no id in response"

# 5. Direct R2 upload via presigned PUT URL
status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$UPLOAD_URL" \
  -H "Content-Type: video/x-matroska" --data-binary $'\x00')
check_status "PUT presigned R2 URL" "200" "$status"

# 6. Start workflow
status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/$VIDEO_ID/process" \
  -H "$AUTH_HEADER")
check_status "POST /api/videos/:id/process" "200" "$status"

# 7. Double-process guard
status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/videos/$VIDEO_ID/process" \
  -H "$AUTH_HEADER")
check_status "POST /api/videos/:id/process (already processing)" "400" "$status"

# 8. List videos
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/videos" -H "$AUTH_HEADER")
check_status "GET /api/videos" "200" "$status"

# 9. Get single video
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/videos/$VIDEO_ID" -H "$AUTH_HEADER")
check_status "GET /api/videos/:id" "200" "$status"

# 10. Get nonexistent video
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/videos/nonexistent-id" -H "$AUTH_HEADER")
check_status "GET /api/videos/nonexistent-id" "404" "$status"

# 11. Workflow status
status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/videos/$VIDEO_ID/status" -H "$AUTH_HEADER")
check_status "GET /api/videos/:id/status" "200" "$status"

echo ""
echo "All smoke tests passed."
```

> **Note on test 5 (presigned PUT):** This makes a real call to R2. It will fail
> if `wrangler dev` is using local simulation (no actual R2 credentials). When running
> against the real provisioned bucket the call succeeds; with `--local` it will 403 or
> time out. The script should note this and make step 5 a "soft" check (warn rather than
> abort) if `SMOKE_LOCAL=1` is set.

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `src/workflow.ts` — class has detailed JSDoc, step 1 is implemented, steps 2–6 are commented placeholders
3. Inspect `src/index.ts` — exports both `VideoProcessingWorkflow` and `FFmpegContainer`
4. Run `bash scripts/smoke-test.sh` with `wrangler dev` running — all 11 checks pass
   (test 5 may warn instead of fail if `SMOKE_LOCAL=1` is set for fully-local runs)

## Other Notes

This is the **most important file in the project** from a blog perspective. The code must be clean, linear, and readable. Every step should have a comment explaining what it does and why. Avoid abstractions that obscure the flow — a reader should be able to understand the entire pipeline by reading this one file top to bottom.
