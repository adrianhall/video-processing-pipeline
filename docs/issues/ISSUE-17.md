# Issue 17 — Workflow: Create Grayscale Video

## Summary

Implement Step 4 of the workflow: create a grayscale version of the transcoded MP4 video using the ffmpeg container. This is the version that will be uploaded to Cloudflare Stream for playback.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`

## Dependencies

- ISSUE-16 (previous step in the linear pipeline — ensures the pattern is established)

## Acceptance Criteria

- [ ] Step 4 in `src/workflow.ts` is implemented with name `'grayscale'`
- [ ] The step updates D1 status to `grayscaling`
- [ ] The step generates presigned GET URL for `video/{videoId}.mp4` and presigned PUT URL for `bwvideo/{videoId}.mp4`
- [ ] The step calls the container's `POST /grayscale` endpoint
- [ ] On success, updates D1 with `r2_bw_key = 'bwvideo/{videoId}.mp4'`
- [ ] On container error (`ok: false`), the step throws
- [ ] Step has retry config: `{ retries: { limit: 3, delay: "10 seconds" } }`
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/workflow.ts` | Modified | Replace step 4 placeholder with grayscale implementation |

## Technical Implementation

### Step Implementation

Follows the identical container-call pattern established in ISSUE-15 and ISSUE-16:

```typescript
await step.do('grayscale', { retries: { limit: 3, delay: "10 seconds" } }, async () => {
  await this.env.DB.prepare(
    'UPDATE videos SET status = ?, updated_at = ? WHERE id = ?'
  ).bind('grayscaling', new Date().toISOString(), videoId).run();

  const inputUrl = await generatePresignedUrl(this.env, bucketName, `video/${videoId}.mp4`, "GET");
  const outputKey = `bwvideo/${videoId}.mp4`;
  const outputUrl = await generatePresignedUrl(this.env, bucketName, outputKey, "PUT");

  const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
  const resp = await container.fetch("http://container/grayscale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input_url: inputUrl, output_url: outputUrl }),
  });
  const result = await resp.json();
  if (!result.ok) throw new Error(`Grayscale conversion failed: ${result.error}`);

  await this.env.DB.prepare(
    'UPDATE videos SET r2_bw_key = ?, updated_at = ? WHERE id = ?'
  ).bind(outputKey, new Date().toISOString(), videoId).run();
});
```

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `src/workflow.ts` — all four implemented steps (register, transcode, extract-audio, grayscale) follow a consistent pattern

## Other Notes

After this step, the container has done all its work. The `sleepAfter(60)` from ISSUE-13 means it will auto-stop after 60 seconds of inactivity. Steps 5 and 6 (ISSUE-18) do not use the container.
