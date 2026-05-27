#!/usr/bin/env bash
# pipeline-smoke-test.sh — end-to-end workflow pipeline smoke test.
#
# Verifies the complete VideoProcessingWorkflow (ISSUE-15 through ISSUE-18) by
# uploading a real video file, starting the pipeline, polling until the workflow
# reaches "complete", and then checking every D1 output field.
#
# Each numbered test below maps to the issue that implemented the step under test:
#
#   Test 1   POST /api/videos — register the video
#   Test 2   PUT presigned URL — upload the file directly to R2
#   Test 3   POST /api/videos/:id/process — start the workflow
#   Test 4   Poll GET /api/videos/:id until status is "complete" or "error"
#   Test 5   status = "complete"                [ISSUE-18: finalize step]
#   Test 6   stream_url non-null in API         [ISSUE-18: Stream upload step]
#   Test 7   r2_video_key correct in D1         [ISSUE-15: transcode step]
#   Test 8   r2_audio_key correct in D1         [ISSUE-16: extract-audio step]
#   Test 9   r2_bw_key correct in D1            [ISSUE-17: grayscale step]
#   Test 10  (removed — Stream replaced by direct R2 playback)
#
# Run this script after all six workflow steps are deployed (ISSUE-18 complete).
# Run with each demo video to exercise every code path:
#
#   test-1.mp4  (MP4)  — exercises ISSUE-15 fast path (R2 copy, no container)
#   test-2.avi  (AVI)  — exercises ISSUE-15 slow path + container all steps
#   test-3.webm (WebM) — same slow path; smallest file for fastest turnaround
#
# Prerequisites:
#   - wrangler dev is running against real bindings: npm start
#     (presigned R2 PUT URLs and the container require real R2 — not --local)
#   - wrangler CLI on PATH and wrangler.jsonc present (for Tests 7–10)
#   - npx / tsx available on PATH
#
# Usage:
#   bash scripts/pipeline-smoke-test.sh demo-videos/test-3.webm
#   bash scripts/pipeline-smoke-test.sh demo-videos/test-1.mp4
#   VIDEO_FILE=demo-videos/test-2.avi bash scripts/pipeline-smoke-test.sh
#
# Run all three demo videos in sequence to exercise all code paths:
#   for f in demo-videos/test-1.mp4 demo-videos/test-2.avi demo-videos/test-3.webm; do
#     echo ""; echo "--- $f ---"; bash scripts/pipeline-smoke-test.sh "$f" || break
#   done
#
# Environment variables:
#   VIDEO_FILE     Path to a video file (required; or pass as the first argument)
#   BASE           Base URL for the Worker (default: http://localhost:8787)
#   POLL_TIMEOUT   Seconds to wait for pipeline completion (default: 300)
#   POLL_INTERVAL  Polling frequency in seconds (default: 5)
#   D1_LOCAL       Set to 1 to query local D1 simulation instead of remote
#
# Exit codes:
#   0  All checks passed.
#   1  One or more checks failed.

set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
POLL_TIMEOUT="${POLL_TIMEOUT:-300}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
D1_LOCAL="${D1_LOCAL:-0}"
VIDEO_FILE="${VIDEO_FILE:-${1:-}}"

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

if [ -z "$VIDEO_FILE" ]; then
  echo "Error: no video file specified."
  echo ""
  echo "Usage: bash scripts/pipeline-smoke-test.sh <video-file>"
  echo "  e.g. bash scripts/pipeline-smoke-test.sh demo-videos/test-3.webm"
  exit 1
fi

if [ ! -f "$VIDEO_FILE" ]; then
  echo "Error: file not found: $VIDEO_FILE"
  exit 1
fi

if [ ! -f "wrangler.jsonc" ]; then
  echo "Warning: wrangler.jsonc not found — Tests 7-10 (D1 field checks) will be skipped."
  echo "  Run 'npm run provision' to generate wrangler.jsonc, then re-run this script."
  SKIP_D1=1
else
  SKIP_D1=0
fi

# Derive MIME type and display name from the file extension
VIDEO_EXT="${VIDEO_FILE##*.}"
case "$VIDEO_EXT" in
  mp4)  VIDEO_MIME="video/mp4" ;;
  avi)  VIDEO_MIME="video/x-msvideo" ;;
  webm) VIDEO_MIME="video/webm" ;;
  mkv)  VIDEO_MIME="video/x-matroska" ;;
  mov)  VIDEO_MIME="video/quicktime" ;;
  *)    VIDEO_MIME="application/octet-stream" ;;
esac

VIDEO_FILENAME=$(basename "$VIDEO_FILE")
VIDEO_SIZE=$(du -sh "$VIDEO_FILE" | cut -f1)

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

# Asserts that a value is non-empty and not the literal string "null".
check_nonempty() {
  local label="$1" value="$2"
  if [ -n "$value" ] && [ "$value" != "null" ]; then
    pass "$label: $value"
  else
    fail "$label — expected a non-empty value, got: '${value}'"
  fi
}

# ---------------------------------------------------------------------------
# Obtain a developer JWT
# ---------------------------------------------------------------------------

echo "=== Pipeline Smoke Test (${BASE}) ==="
echo "    File:  ${VIDEO_FILE} (${VIDEO_SIZE}, ${VIDEO_MIME})"
echo ""
echo "Minting dev JWT..."
TOKEN=$(npx tsx scripts/get-dev-token.ts)
AUTH_HEADER="cf-access-jwt-assertion: ${TOKEN}"
echo "  Token: ${TOKEN:0:40}…"
echo ""

# ---------------------------------------------------------------------------
# Test 1: Register the video — POST /api/videos
# ---------------------------------------------------------------------------

echo "Test 1: POST /api/videos — register ${VIDEO_FILENAME}"
echo "  → POST ${BASE}/api/videos  body={\"filename\":\"${VIDEO_FILENAME}\"}"
response=$(curl -s \
  -X POST "${BASE}/api/videos" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"filename\":\"${VIDEO_FILENAME}\"}")
echo "  ← $response"

VIDEO_ID=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
UPLOAD_URL=$(echo "$response" | grep -o '"upload_url":"[^"]*"' | cut -d'"' -f4)

if [ -n "$VIDEO_ID" ]; then
  pass "POST /api/videos — id: ${VIDEO_ID}"
else
  fail "POST /api/videos — no id in response: ${response}"
fi
if [ -n "$UPLOAD_URL" ]; then
  pass "POST /api/videos — upload_url received"
else
  fail "POST /api/videos — no upload_url in response: ${response}"
fi

# ---------------------------------------------------------------------------
# Test 2: Upload the file to R2 via the presigned PUT URL
# ---------------------------------------------------------------------------

echo "Test 2: PUT ${VIDEO_FILENAME} to R2 via presigned URL"
echo "  → PUT [presigned R2 URL]  Content-Type: ${VIDEO_MIME}  size: ${VIDEO_SIZE}"
_r2_tmp=$(mktemp)
r2_status=$(curl -s -w "%{http_code}" \
  -X PUT "$UPLOAD_URL" \
  -H "Content-Type: ${VIDEO_MIME}" \
  --data-binary "@${VIDEO_FILE}" \
  -o "$_r2_tmp")
_r2_body=$(cat "$_r2_tmp"); rm -f "$_r2_tmp"
echo "  ← HTTP $r2_status${_r2_body:+  body: $_r2_body}"
check_status "PUT presigned R2 URL" "200" "$r2_status"

# ---------------------------------------------------------------------------
# Test 3: Start the workflow — POST /api/videos/:id/process
# ---------------------------------------------------------------------------

echo "Test 3: POST /api/videos/${VIDEO_ID}/process — start pipeline"
echo "  → POST ${BASE}/api/videos/${VIDEO_ID}/process"
_proc_tmp=$(mktemp)
proc_status=$(curl -s -w "%{http_code}" \
  -X POST "${BASE}/api/videos/${VIDEO_ID}/process" \
  -H "$AUTH_HEADER" \
  -o "$_proc_tmp")
_proc_body=$(cat "$_proc_tmp"); rm -f "$_proc_tmp"
echo "  ← HTTP $proc_status  $_proc_body"
check_status "POST /api/videos/:id/process" "200" "$proc_status"

# ---------------------------------------------------------------------------
# Test 4: Poll until the pipeline reaches "complete" or "error"
#
# The pipeline for a short WebM takes ~30-60s on a warm container.
# MP4 passthrough (no container) completes in a few seconds.
# A large AVI may take several minutes (increase POLL_TIMEOUT if needed).
# ---------------------------------------------------------------------------

echo "Test 4: Polling for completion (timeout: ${POLL_TIMEOUT}s, interval: ${POLL_INTERVAL}s)…"
elapsed=0
final_status=""
last_status=""

while [ "$elapsed" -lt "$POLL_TIMEOUT" ]; do
  video_json=$(curl -s "${BASE}/api/videos/${VIDEO_ID}" -H "$AUTH_HEADER" 2>/dev/null || echo "")
  current_status=$(echo "$video_json" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)

  if [ -z "$video_json" ]; then
    printf "  [%3ds] WARNING: empty response from GET /api/videos/:id\n" "$elapsed"
  elif [ "$current_status" != "$last_status" ] && [ -n "$current_status" ]; then
    # Status changed — print prominently and dump the full record so the
    # error_message (and any other field) is visible without extra queries.
    printf "  [%3ds] *** STATUS CHANGE: %s → %s ***\n" "$elapsed" "${last_status:-started}" "$current_status"
    printf "         %s\n" "$video_json"
    last_status="$current_status"
  else
    # No change — print a heartbeat so the terminal doesn't look frozen.
    printf "  [%3ds] %s\n" "$elapsed" "${current_status:-unknown}"
  fi

  if [ "$current_status" = "complete" ] || [ "$current_status" = "error" ]; then
    final_status="$current_status"
    break
  fi

  sleep "$POLL_INTERVAL"
  elapsed=$((elapsed + POLL_INTERVAL))
done

if [ -z "$final_status" ]; then
  fail "Pipeline did not complete within ${POLL_TIMEOUT}s (last status: ${last_status:-unknown})"
fi

# ---------------------------------------------------------------------------
# Test 5: Verify status = "complete"                              [ISSUE-18]
# ---------------------------------------------------------------------------

echo "Test 5: Verify final status = \"complete\"  [ISSUE-18: finalize step]"
if [ "$final_status" = "complete" ]; then
  pass "Pipeline status: complete"
else
  # Fetch the final video record and print it in full so every field —
  # including the complete error_message — is visible without extra queries.
  # (The grep approach used elsewhere truncates at the first embedded quote.)
  _err_json=$(curl -s "${BASE}/api/videos/${VIDEO_ID}" -H "$AUTH_HEADER" 2>/dev/null || echo "")
  echo "  Final video record:"
  echo "  $_err_json"
  fail "Pipeline ended in status '${final_status}'"
fi

# ---------------------------------------------------------------------------
# Test 6: Verify stream_url is set in the API response            [ISSUE-18]
# ---------------------------------------------------------------------------

echo "Test 6: Verify play_url in API response and streaming endpoint responds"
video_json=$(curl -s "${BASE}/api/videos/${VIDEO_ID}" -H "$AUTH_HEADER" 2>/dev/null || echo "")
echo "  ← $video_json"
play_url=$(echo "$video_json" | grep -o '"play_url":"[^"]*"' | cut -d'"' -f4)
check_nonempty "play_url" "$play_url"
# Also verify the stream endpoint itself returns HTTP 200 with video/mp4
if [ -n "$play_url" ]; then
  _stream_status=$(curl -s -o /dev/null -w "%{http_code}" "${BASE}${play_url}" -H "$AUTH_HEADER")
  echo "  Stream endpoint HTTP status: $_stream_status"
  if [ "$_stream_status" = "200" ] || [ "$_stream_status" = "206" ]; then
    pass "Stream endpoint returned HTTP $_stream_status"
  else
    fail "Stream endpoint — expected 200/206, got $_stream_status"
  fi
fi

# ---------------------------------------------------------------------------
# Tests 7-10: D1 field verification via wrangler d1 execute
#
# These tests check the internal R2 keys stored in D1 that are not exposed
# through the public VideoResource API.  They require wrangler CLI and a
# valid wrangler.jsonc.
# ---------------------------------------------------------------------------

if [ "$SKIP_D1" = "1" ]; then
  echo ""
  echo "Skipping Tests 7-10 (wrangler.jsonc not found — run npm run provision first)."
else
  echo "Querying D1 for internal output fields…"
  D1_FLAG="--remote"
  [ "$D1_LOCAL" = "1" ] && D1_FLAG="--local"

  d1_json=$(npx wrangler d1 execute video-pipeline-db \
    $D1_FLAG \
    --config wrangler.jsonc \
    --command "SELECT r2_video_key, r2_audio_key, r2_bw_key FROM videos WHERE id='${VIDEO_ID}'" \
    --json 2>/dev/null || echo "[]")
  echo "  D1 query result: $d1_json"

  r2_video_key=$(echo "$d1_json" | grep -o '"r2_video_key":"[^"]*"' | cut -d'"' -f4)
  r2_audio_key=$(echo "$d1_json" | grep -o '"r2_audio_key":"[^"]*"' | cut -d'"' -f4)
  r2_bw_key=$(echo "$d1_json"    | grep -o '"r2_bw_key":"[^"]*"'    | cut -d'"' -f4)

  # -------------------------------------------------------------------------
  # Test 7: r2_video_key = "video/{videoId}.mp4"                  [ISSUE-15]
  #
  # Set by Step 2 (transcode).  For MP4 inputs this is a direct R2 copy;
  # for all other formats the ffmpeg container re-encodes to H.264/AAC MP4.
  # -------------------------------------------------------------------------
  echo "Test 7: Verify r2_video_key in D1  [ISSUE-15: transcode step]"
  expected_video_key="video/${VIDEO_ID}.mp4"
  if [ "$r2_video_key" = "$expected_video_key" ]; then
    pass "r2_video_key: ${r2_video_key}"
  else
    fail "r2_video_key: expected '${expected_video_key}', got '${r2_video_key}'"
  fi

  # -------------------------------------------------------------------------
  # Test 8: r2_audio_key = "audio/{videoId}.mp3"                  [ISSUE-16]
  #
  # Set by Step 3 (extract-audio).  The ffmpeg container strips the video
  # track and encodes the audio to MP3 via libmp3lame.
  # -------------------------------------------------------------------------
  echo "Test 8: Verify r2_audio_key in D1  [ISSUE-16: extract-audio step]"
  expected_audio_key="audio/${VIDEO_ID}.mp3"
  if [ "$r2_audio_key" = "$expected_audio_key" ]; then
    pass "r2_audio_key: ${r2_audio_key}"
  else
    fail "r2_audio_key: expected '${expected_audio_key}', got '${r2_audio_key}'"
  fi

  # -------------------------------------------------------------------------
  # Test 9: r2_bw_key = "bwvideo/{videoId}.mp4"                   [ISSUE-17]
  #
  # Set by Step 4 (grayscale).  The ffmpeg container applies the
  # `format=gray` filter while keeping the original audio track.
  # -------------------------------------------------------------------------
  echo "Test 9: Verify r2_bw_key in D1  [ISSUE-17: grayscale step]"
  expected_bw_key="bwvideo/${VIDEO_ID}.mp4"
  if [ "$r2_bw_key" = "$expected_bw_key" ]; then
    pass "r2_bw_key: ${r2_bw_key}"
  else
    fail "r2_bw_key: expected '${expected_bw_key}', got '${r2_bw_key}'"
  fi

fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "All pipeline smoke tests passed."
echo ""
echo "  video ID:        ${VIDEO_ID}"
echo "  file:            ${VIDEO_FILENAME} (${VIDEO_EXT} → MP4 pipeline)"
if [ "$SKIP_D1" = "0" ]; then
  echo "  r2_video_key:    ${r2_video_key}"
  echo "  r2_audio_key:    ${r2_audio_key}"
  echo "  r2_bw_key:       ${r2_bw_key}"
fi
echo "  play_url:        ${play_url}"
