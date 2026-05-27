# Issue 18 — Workflow: Upload to Stream and Finalize

## Summary

Implement the final two workflow steps: Step 5 uploads the grayscale video to Cloudflare Stream via the Stream API, and Step 6 finalizes by updating D1 to `complete` and deleting the incoming file from R2. After this issue, the full pipeline is functional end-to-end.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`

## Dependencies

- ISSUE-17 (grayscale step produces the video to upload)

## Acceptance Criteria

- [ ] Step 5 (`upload-to-stream`) is implemented: updates status to `uploading_to_stream`, generates a presigned GET URL for the grayscale video, calls the Cloudflare Stream "copy from URL" API, stores `stream_video_id` and `stream_url` in D1
- [ ] Step 6 (`finalize`) is implemented: updates status to `complete`, deletes the incoming file from R2 (`BUCKET.delete(r2IncomingKey)`)
- [ ] The Stream API call uses `env.CF_API_TOKEN` for authentication and `env.CF_ACCOUNT_ID` for the account
- [ ] Stream API endpoint: `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/stream/copy`
- [ ] The step stores the `stream_url` in the format suitable for the `@cloudflare/stream-react` player
- [ ] Both steps have appropriate retry config
- [ ] `npm run check` passes
- [ ] The full workflow (steps 1–6) reads linearly from top to bottom with clear comments

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/workflow.ts` | Modified | Replace step 5 and 6 placeholders with Stream upload and finalize |

## Technical Implementation

### Step 5: Upload to Stream

```typescript
await step.do('upload-to-stream', { retries: { limit: 3, delay: "30 seconds" } }, async () => {
  await this.env.DB.prepare(
    'UPDATE videos SET status = ?, updated_at = ? WHERE id = ?'
  ).bind('uploading_to_stream', new Date().toISOString(), videoId).run();

  // Generate a presigned URL for Stream to download from
  const videoUrl = await generatePresignedUrl(
    this.env, bucketName, `bwvideo/${videoId}.mp4`, "GET", 3600
  );

  // Call Stream "copy from URL" API
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/stream/copy`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: videoUrl, meta: { name: filename } }),
    }
  );

  const data = await resp.json();
  if (!data.success) throw new Error(`Stream upload failed: ${JSON.stringify(data.errors)}`);

  const streamVideoId = data.result.uid;
  const streamUrl = `https://customer-${this.env.CF_ACCOUNT_ID}.cloudflarestream.com/${streamVideoId}/iframe`;

  await this.env.DB.prepare(
    'UPDATE videos SET stream_video_id = ?, stream_url = ?, updated_at = ? WHERE id = ?'
  ).bind(streamVideoId, streamUrl, new Date().toISOString(), videoId).run();
});
```

### Step 6: Finalize

```typescript
await step.do('finalize', async () => {
  // Delete the incoming file from R2
  await this.env.BUCKET.delete(r2IncomingKey);

  // Mark as complete
  await this.env.DB.prepare(
    'UPDATE videos SET status = ?, updated_at = ? WHERE id = ?'
  ).bind('complete', new Date().toISOString(), videoId).run();
});
```

### Stream URL Format

The `stream_url` stored in D1 should be the iframe embed URL. The `@cloudflare/stream-react` component uses the video UID directly, so also store `stream_video_id`. The frontend (ISSUE-22) will use whichever is appropriate.

Note: The exact Stream URL format may need adjustment based on the current Stream API response. Consult the Cloudflare Stream documentation for the correct playback URL pattern.

## Manual Tests

### Static checks

1. Run `npm run check` — passes
2. Inspect `src/workflow.ts` — all 6 steps are implemented, the file reads linearly, every step has comments
3. Count the `step.do()` calls — exactly 6 named steps plus the error handler

### End-to-end pipeline smoke test (`scripts/pipeline-smoke-test.sh`)

Run **after** this issue is deployed and `wrangler dev` is running against real bindings
(`npm start`). Three demo videos are provided in `demo-videos/` (gitignored — copy your
own files there). Each invocation exercises a different code path:

**WebM → full container pipeline** (fastest — 2.3 MB; use this for quick iteration):

```bash
bash scripts/pipeline-smoke-test.sh demo-videos/test-3.webm
```

Verifies: ISSUE-15 slow path (transcode), ISSUE-16 (extract audio), ISSUE-17 (grayscale), ISSUE-18 (Stream upload + finalize).

**MP4 → fast-path bypass** (no container; tests ISSUE-15 R2 copy branch):

```bash
bash scripts/pipeline-smoke-test.sh demo-videos/test-1.mp4
```

Verifies: ISSUE-15 MP4 passthrough (direct R2 copy, no container call), then continues through ISSUE-16–18 as normal.

**AVI → full container pipeline** (largest file; stress-tests the container under load):

```bash
bash scripts/pipeline-smoke-test.sh demo-videos/test-2.avi
```

Verifies: ISSUE-15 slow path with a non-WebM source format.

**Run all three in sequence** to cover every code path in a single pass:

```bash
for f in demo-videos/test-1.mp4 demo-videos/test-2.avi demo-videos/test-3.webm; do
  echo ""; echo "--- $f ---"
  bash scripts/pipeline-smoke-test.sh "$f" || break
done
```

Each test run reports 10 numbered checks. Tests 7–10 query D1 directly via
`wrangler d1 execute` and require `wrangler.jsonc` to exist (run
`npm run provision` first):

| Test | What is checked | Verifies |
|------|----------------|----------|
| 1 | `POST /api/videos` returns `id` + `upload_url` | API (ISSUE-08) |
| 2 | Presigned PUT to R2 returns 200 | R2 upload (ISSUE-07/08) |
| 3 | `POST /api/videos/:id/process` returns 200 | Workflow start (ISSUE-09) |
| 4 | Status transitions logged until `complete` or `error` | All steps |
| 5 | Final status = `complete` | ISSUE-18 (finalize) |
| 6 | `stream_url` non-null in API response | ISSUE-18 (Stream upload) |
| 7 | `r2_video_key` = `video/{id}.mp4` in D1 | ISSUE-15 (transcode) |
| 8 | `r2_audio_key` = `audio/{id}.mp3` in D1 | ISSUE-16 (extract audio) |
| 9 | `r2_bw_key` = `bwvideo/{id}.mp4` in D1 | ISSUE-17 (grayscale) |
| 10 | `stream_video_id` non-null in D1 | ISSUE-18 (Stream upload) |

Expected output (abridged):

```text
=== Pipeline Smoke Test (http://localhost:8787) ===
    File:  demo-videos/test-3.webm (2.3M, video/webm)

Minting dev JWT...
  Token: eyJhbGciOiJIUzI1NiIs…

Test 1: POST /api/videos — register test-3.webm
  PASS: POST /api/videos — id: 01960b1e-...
  PASS: POST /api/videos — upload_url received
Test 2: PUT test-3.webm to R2 via presigned URL
  PASS: PUT presigned R2 URL (HTTP 200)
Test 3: POST /api/videos/01960b1e-.../process — start pipeline
  PASS: POST /api/videos/:id/process (HTTP 200)
Test 4: Polling for completion (timeout: 300s, interval: 5s)…
  [  0s] status changed: started → processing
  [ 10s] status changed: processing → transcoding
  [ 25s] status changed: transcoding → extracting_audio
  [ 35s] status changed: extracting_audio → grayscaling
  [ 50s] status changed: grayscaling → uploading_to_stream
  [ 60s] status changed: uploading_to_stream → complete
Test 5: Verify final status = "complete"  [ISSUE-18: finalize step]
  PASS: Pipeline status: complete
Test 6: Verify stream_url in API response  [ISSUE-18: Stream upload step]
  PASS: stream_url: https://customer-xxx.cloudflarestream.com/.../iframe
...
All pipeline smoke tests passed.
```

> **Note on large files:** `test-1.mp4` is 88 MB. The presigned PUT uploads the
> full file to R2, which may take a minute on a slow connection. The container
> transcoding time also scales with file size. Set `POLL_TIMEOUT=600` if the
> default 300-second timeout is too short.
>
> ```bash
> POLL_TIMEOUT=600 bash scripts/pipeline-smoke-test.sh demo-videos/test-1.mp4
> ```

## Other Notes

After this issue, the full backend pipeline is complete. A video uploaded via the API (ISSUE-08) will flow through all 6 workflow steps: register → transcode → extract audio → grayscale → upload to Stream → finalize. The frontend (ISSUE-19 through ISSUE-23) provides the UI for this flow.
