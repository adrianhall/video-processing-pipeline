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

1. Run `npm run check` — passes
2. Inspect `src/workflow.ts` — all 6 steps are implemented, the file reads linearly, every step has comments
3. Count the `step.do()` calls — exactly 6 named steps plus the error handler

## Other Notes

After this issue, the full backend pipeline is complete. A video uploaded via the API (ISSUE-08) will flow through all 6 workflow steps: register → transcode → extract audio → grayscale → upload to Stream → finalize. The frontend (ISSUE-19 through ISSUE-23) provides the UI for this flow.
