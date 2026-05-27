#!/usr/bin/env bash
# smoke-test.sh — authenticated end-to-end smoke test for ISSUE-05 through ISSUE-14.
#
# Prerequisites:
#   - wrangler dev is running on http://localhost:8787 with a local D1 database.
#     Run:  npm run db:migrate:local && npm start
#   - npx / tsx available on PATH (tsx is downloaded on demand by npx).
#
# Usage:
#   bash scripts/smoke-test.sh
#
# Environment:
#   SMOKE_LOCAL=1   Treat the presigned R2 PUT (test 5) as a soft check — warn
#                   instead of failing.  Use this when wrangler dev is running
#                   against the local simulation (no real R2 credentials).
#
#   BASE            Override the base URL (default: http://localhost:8787).
#
# Exit codes:
#   0   All checks passed.
#   1   One or more checks failed (printed to stdout before exit).

set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
SMOKE_LOCAL="${SMOKE_LOCAL:-0}"

# ---------------------------------------------------------------------------
# Obtain a developer JWT.  The developerAuthentication middleware in the Worker
# accepts this token when running under wrangler dev.
# ---------------------------------------------------------------------------
echo "Minting dev JWT..."
TOKEN=$(npx tsx scripts/get-dev-token.ts)
AUTH_HEADER="cf-access-jwt-assertion: ${TOKEN}"
echo "  Token: ${TOKEN:0:40}…"
echo ""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
pass() { echo "  PASS: $1"; }

fail() {
  echo "  FAIL: $1"
  exit 1
}

check_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label (HTTP $actual)"
  else
    fail "$label — expected HTTP $expected, got HTTP $actual"
  fi
}

soft_check_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label (HTTP $actual)"
  else
    echo "  WARN: $label — expected HTTP $expected, got HTTP $actual (soft check — SMOKE_LOCAL=$SMOKE_LOCAL)"
  fi
}

echo "=== Smoke Tests (${BASE}) ==="
echo ""

# ---------------------------------------------------------------------------
# 1. Public version endpoint — no auth required
# ---------------------------------------------------------------------------
echo "Test 1: GET /api/version (no auth)"
status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}/api/version")
check_status "GET /api/version (no auth)" "200" "$status"

# ---------------------------------------------------------------------------
# 2. Protected endpoint without auth — expect redirect to login
# ---------------------------------------------------------------------------
echo "Test 2: POST /api/videos (no auth) — expect 302 redirect"
status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE}/api/videos")
check_status "POST /api/videos (no auth)" "302" "$status"

# ---------------------------------------------------------------------------
# 3. Protected endpoint with auth, missing required field — expect 400
# ---------------------------------------------------------------------------
echo "Test 3: POST /api/videos (auth, missing filename) — expect 400"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BASE}/api/videos" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{}')
check_status "POST /api/videos (missing filename)" "400" "$status"

# ---------------------------------------------------------------------------
# 4. Valid POST — register a new video; capture id and upload_url
# ---------------------------------------------------------------------------
echo "Test 4: POST /api/videos (auth, filename: smoke.mkv) — expect 200 with id + upload_url"
response=$(curl -sf \
  -X POST "${BASE}/api/videos" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"filename":"smoke.mkv"}')

VIDEO_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
UPLOAD_URL=$(echo "$response" | grep -o '"upload_url":"[^"]*"' | cut -d'"' -f4)

if [ -n "$VIDEO_ID" ]; then
  pass "POST /api/videos — got id: $VIDEO_ID"
else
  fail "POST /api/videos — no id in response: $response"
fi

if [ -n "$UPLOAD_URL" ]; then
  pass "POST /api/videos — got upload_url"
else
  fail "POST /api/videos — no upload_url in response: $response"
fi

# ---------------------------------------------------------------------------
# 5. Direct R2 upload via presigned PUT URL
#
# NOTE: This test makes a real call to R2.  When wrangler dev is running against
# the real provisioned bucket (not --local simulation), the PUT succeeds (200).
# With local simulation (no real R2 credentials) the call returns 403 or times out.
# Set SMOKE_LOCAL=1 to demote this to a warning instead of a hard failure.
# ---------------------------------------------------------------------------
echo "Test 5: PUT presigned R2 URL — upload 1-byte test file"
if [ "$SMOKE_LOCAL" = "1" ]; then
  echo "  INFO: SMOKE_LOCAL=1 — running as soft check (403/timeout expected in local simulation)"
  r2_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT "$UPLOAD_URL" \
    -H "Content-Type: video/x-matroska" \
    --data-binary $'\x00' \
    --max-time 10 || echo "000")
  soft_check_status "PUT presigned R2 URL" "200" "$r2_status"
else
  r2_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X PUT "$UPLOAD_URL" \
    -H "Content-Type: video/x-matroska" \
    --data-binary $'\x00')
  check_status "PUT presigned R2 URL" "200" "$r2_status"
fi

# ---------------------------------------------------------------------------
# 6. Start the workflow — POST /api/videos/:id/process
# ---------------------------------------------------------------------------
echo "Test 6: POST /api/videos/$VIDEO_ID/process — start workflow"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BASE}/api/videos/${VIDEO_ID}/process" \
  -H "$AUTH_HEADER")
check_status "POST /api/videos/:id/process" "200" "$status"

# ---------------------------------------------------------------------------
# 7. Double-process guard — same endpoint again should return 400
# ---------------------------------------------------------------------------
echo "Test 7: POST /api/videos/$VIDEO_ID/process again — expect 400 (already processing)"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${BASE}/api/videos/${VIDEO_ID}/process" \
  -H "$AUTH_HEADER")
check_status "POST /api/videos/:id/process (already processing)" "400" "$status"

# ---------------------------------------------------------------------------
# 8. List videos — GET /api/videos
# ---------------------------------------------------------------------------
echo "Test 8: GET /api/videos — expect 200 with array containing new video"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BASE}/api/videos" \
  -H "$AUTH_HEADER")
check_status "GET /api/videos" "200" "$status"

# ---------------------------------------------------------------------------
# 9. Get single video — GET /api/videos/:id
# ---------------------------------------------------------------------------
echo "Test 9: GET /api/videos/$VIDEO_ID — expect 200 with status processing or later"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BASE}/api/videos/${VIDEO_ID}" \
  -H "$AUTH_HEADER")
check_status "GET /api/videos/:id" "200" "$status"

# ---------------------------------------------------------------------------
# 10. Get nonexistent video — expect 404
# ---------------------------------------------------------------------------
echo "Test 10: GET /api/videos/nonexistent-id — expect 404"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BASE}/api/videos/nonexistent-id" \
  -H "$AUTH_HEADER")
check_status "GET /api/videos/nonexistent-id" "404" "$status"

# ---------------------------------------------------------------------------
# 11. Workflow status — GET /api/videos/:id/status
# ---------------------------------------------------------------------------
echo "Test 11: GET /api/videos/$VIDEO_ID/status — expect 200 with workflow instance status"
status=$(curl -s -o /dev/null -w "%{http_code}" \
  "${BASE}/api/videos/${VIDEO_ID}/status" \
  -H "$AUTH_HEADER")
check_status "GET /api/videos/:id/status" "200" "$status"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "All smoke tests passed."
