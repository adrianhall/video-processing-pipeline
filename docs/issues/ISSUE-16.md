# Issue 16 — Workflow: Extract Audio

## Summary

Implement Step 3 of the workflow: extract the audio track from the transcoded MP4 video to an MP3 file using the ffmpeg container.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`

## Dependencies

- ISSUE-15 (transcode step produces the MP4 input for this step)

## Acceptance Criteria

- [ ] Step 3 in `src/workflow.ts` is implemented with name `'extract-audio'`
- [ ] The step updates D1 status to `extracting_audio`
- [ ] The step generates presigned GET URL for `video/{videoId}.mp4` and presigned PUT URL for `audio/{videoId}.mp3`
- [ ] The step calls the container's `POST /extract-audio` endpoint
- [ ] On success, updates D1 with `r2_audio_key = 'audio/{videoId}.mp3'`
- [ ] On container error (`ok: false`), the step throws
- [ ] Step has retry config: `{ retries: { limit: 3, delay: "10 seconds" } }`
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/workflow.ts` | Modified | Replace step 3 placeholder with extract-audio implementation |

## Technical Implementation

### Step Implementation

```typescript
await step.do('extract-audio', { retries: { limit: 3, delay: "10 seconds" } }, async () => {
  await this.env.DB.prepare(
    'UPDATE videos SET status = ?, updated_at = ? WHERE id = ?'
  ).bind('extracting_audio', new Date().toISOString(), videoId).run();

  const inputUrl = await generatePresignedUrl(this.env, bucketName, `video/${videoId}.mp4`, "GET");
  const outputKey = `audio/${videoId}.mp3`;
  const outputUrl = await generatePresignedUrl(this.env, bucketName, outputKey, "PUT");

  const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
  const resp = await container.fetch("http://container/extract-audio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input_url: inputUrl, output_url: outputUrl }),
  });
  const result = await resp.json();
  if (!result.ok) throw new Error(`Audio extraction failed: ${result.error}`);

  await this.env.DB.prepare(
    'UPDATE videos SET r2_audio_key = ?, updated_at = ? WHERE id = ?'
  ).bind(outputKey, new Date().toISOString(), videoId).run();
});
```

This follows the exact same pattern as the transcode step. The consistency is intentional for readability — this is blog example code.

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `src/workflow.ts` — step 3 follows the same pattern as step 2

## Other Notes

The container instance is reused via `getByName(videoId)` — the same container that ran the transcode step is still warm (within the 60-second `sleepAfter` window), so there's no cold start penalty for this step.
