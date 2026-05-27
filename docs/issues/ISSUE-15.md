# Issue 15 — Workflow: Detect Format and Transcode

## Summary

Implement Step 2 of the workflow: transcode the uploaded video to MP4 using the ffmpeg container. If the video is already MP4, skip transcoding and copy the incoming file as-is to the `video/` prefix.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`

## Dependencies

- ISSUE-07 (presigned URL utility)
- ISSUE-13 (FFmpegContainer class)
- ISSUE-14 (workflow scaffold with register step)

## Acceptance Criteria

- [ ] Step 2 in `src/workflow.ts` is implemented with name `'transcode'`
- [ ] The step generates presigned GET URL for the incoming file and presigned PUT URL for `video/{videoId}.mp4`
- [ ] If `originalFormat` is `"mp4"`, the step uses R2 binding to copy the object directly (no container call) — avoids unnecessary transcoding
- [ ] If `originalFormat` is not `"mp4"`, the step calls the container's `POST /transcode` endpoint with the presigned URLs
- [ ] The container instance is obtained via `this.env.FFMPEG_CONTAINER.getByName(videoId)`
- [ ] On success, D1 is updated: `status = 'transcoding'` (before the step), `r2_video_key = 'video/{videoId}.mp4'`
- [ ] On container error (`ok: false`), the step throws with the error message
- [ ] Step has retry config: `{ retries: { limit: 3, delay: "10 seconds" } }`
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/workflow.ts` | Modified | Replace step 2 placeholder with transcode implementation |

## Technical Implementation

### Container Call Pattern

```typescript
await step.do('transcode', { retries: { limit: 3, delay: "10 seconds" } }, async () => {
  // Update status
  await this.env.DB.prepare(
    'UPDATE videos SET status = ?, updated_at = ? WHERE id = ?'
  ).bind('transcoding', new Date().toISOString(), videoId).run();

  const inputUrl = await generatePresignedUrl(this.env, bucketName, r2IncomingKey, "GET");
  const outputKey = `video/${videoId}.mp4`;
  const outputUrl = await generatePresignedUrl(this.env, bucketName, outputKey, "PUT");

  if (originalFormat === "mp4") {
    // Copy directly within R2 — no transcoding needed
    const obj = await this.env.BUCKET.get(r2IncomingKey);
    if (obj) await this.env.BUCKET.put(outputKey, obj.body);
  } else {
    // Call container
    const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
    const resp = await container.fetch("http://container/transcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_url: inputUrl, output_url: outputUrl }),
    });
    const result = await resp.json();
    if (!result.ok) throw new Error(`Transcode failed: ${result.error}`);
  }

  // Record the output key
  await this.env.DB.prepare(
    'UPDATE videos SET r2_video_key = ?, updated_at = ? WHERE id = ?'
  ).bind(outputKey, new Date().toISOString(), videoId).run();
});
```

### Bucket Name

The R2 bucket name is needed for presigned URL generation. It can be extracted from `wrangler.jsonc` vars (e.g., store it in a var) or hardcoded to match the Terraform resource name. The simplest approach: add a helper that derives it, or pass it as a workflow param.

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `src/workflow.ts` — step 2 handles both MP4 passthrough and non-MP4 transcode paths

## Other Notes

The MP4 passthrough optimization avoids unnecessary container startup and processing time. For the blog, this is a good example of conditional logic within a workflow step.
