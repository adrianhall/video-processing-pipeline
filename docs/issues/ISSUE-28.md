# Issue 28 — Extract Repeated Helpers from Workflow `run()` Method

## Summary

`src/workflow.ts` repeats three patterns across every step in `run()`:

1. **D1 status updates** — the same `UPDATE videos SET status = ?, updated_at = ? WHERE id = ?` prepared statement appears in steps 1, 2, 3, 4, 5, and the error handler (6 call sites).
2. **Container calls** — steps 2 (slow path), 3, and 4 each build an identical `container.fetch()` POST with JSON `{ input_url, output_url }`, parse the response as `ContainerResult`, and throw on failure (3 call sites).
3. **Structured logging** — every step emits the same `console.log(JSON.stringify({ step, videoId, status, timestamp }))` shape at entry and exit (10 call sites).

Extract each pattern into a private helper method on `VideoProcessingWorkflow` so that `run()` reads as a concise, linear sequence of business logic rather than a wall of boilerplate.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`
- `typescript-advanced-types`

## Dependencies

- ISSUE-18 (workflow implementation is complete and stable)

## Acceptance Criteria

- [ ] A private method handles D1 status updates — accepts a status string and video ID, executes the prepared statement, and returns the D1 result
- [ ] A private method handles container endpoint calls — accepts the container endpoint path, input R2 key, output R2 key, video ID, and an error label; generates both presigned URLs, calls `container.fetch()`, parses `ContainerResult`, and throws a descriptive error on failure
- [ ] A private method handles structured step logging — accepts the step name, video ID, and status (`"started"` | `"completed"`), and emits the JSON log line
- [ ] The `run()` method uses the new helpers with no remaining inline duplicates of the three patterns
- [ ] The `ContainerResult` type stays in `workflow.ts` (it is not exported and has no consumers outside this file)
- [ ] All existing JSDoc on `run()` and the class is preserved; new helpers each get a JSDoc block with `@param` and `@returns`
- [ ] The refactor is behaviour-preserving — no step ordering, retry config, error handling, or fast-path MP4 logic changes
- [ ] `npm run fix && npm run check` passes with zero errors

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/workflow.ts` | Modified | Add three private helpers; simplify `run()` body to use them |

## Technical Implementation

### Helper 1 — `updateStatus`

```ts
private async updateStatus(
  status: string,
  videoId: string,
): Promise<void> {
  await this.env.DB.prepare(
    "UPDATE videos SET status = ?, updated_at = ? WHERE id = ?",
  )
    .bind(status, new Date().toISOString(), videoId)
    .run();
}
```

Replaces the six identical prepared-statement blocks. The error handler's
variant that also sets `error_message` remains inline (it is a one-off shape).

### Helper 2 — `callContainer`

```ts
private async callContainer(
  videoId: string,
  endpoint: string,
  inputKey: string,
  outputKey: string,
  errorLabel: string,
): Promise<void> {
  const inputUrl = await generatePresignedUrl(
    this.env,
    this.env.R2_BUCKET_NAME,
    inputKey,
    "GET",
  );
  const outputUrl = await generatePresignedUrl(
    this.env,
    this.env.R2_BUCKET_NAME,
    outputKey,
    "PUT",
  );

  const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
  const resp = await container.fetch(`http://container/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input_url: inputUrl, output_url: outputUrl }),
  });

  const result = await resp.json<ContainerResult>();
  if (!result.ok) {
    throw new Error(`${errorLabel} failed: ${result.error}`);
  }
}
```

Consolidates the presigned URL generation, container fetch, response parsing,
and error throw that is repeated identically in steps 2 (slow path), 3, and 4.

### Helper 3 — `logStep`

```ts
private logStep(
  stepName: string,
  videoId: string,
  status: "started" | "completed",
): void {
  console.log(
    JSON.stringify({
      step: stepName,
      videoId,
      status,
      timestamp: new Date().toISOString(),
    }),
  );
}
```

Replaces the ten `console.log(JSON.stringify({...}))` call sites with a
one-liner per step boundary.

### After-state of `run()` (sketch)

With all three helpers in place the step bodies become significantly shorter.
For example, step 3 (extract-audio) goes from ~35 lines to roughly:

```ts
await step.do(
  "extract-audio",
  { retries: { limit: 3, delay: "10 seconds" } },
  async () => {
    this.logStep("extract-audio", videoId, "started");
    await this.updateStatus("extracting_audio", videoId);

    const outputKey = `audio/${videoId}.mp3`;
    await this.callContainer(
      videoId,
      "extract-audio",
      `video/${videoId}.mp4`,
      outputKey,
      "Audio extraction",
    );

    await this.env.DB.prepare(
      "UPDATE videos SET r2_audio_key = ?, updated_at = ? WHERE id = ?",
    )
      .bind(outputKey, new Date().toISOString(), videoId)
      .run();

    this.logStep("extract-audio", videoId, "completed");
  },
);
```

Steps 4 (grayscale) and 2 (transcode slow path) follow the same pattern.
Step 2's fast-path MP4 branch remains inline because its logic is unique.

### What stays inline

- The **step 2 MP4 fast-path** (presigned GET → presigned PUT copy) — it does
  not call the container and has its own error semantics.
- The **per-step D1 writes for artifact keys** (`r2_video_key`, `r2_audio_key`,
  `r2_bw_key`) — each writes a different column, so there is no common shape
  to extract.
- The **error handler** `mark-error` step — it writes both `status` and
  `error_message` in a single statement, which does not match `updateStatus`.

## Manual Tests

1. Run `npm run check` — all four checks (biome, types, infra, markdown) must
   pass with zero errors.
2. With `wrangler.jsonc` present, run the full pipeline smoke test
   (`bash scripts/pipeline-smoke-test.sh demo-videos/test-3.webm`) against
   `npm start` — all 9 checks must print `PASS` and the final line must read
   `All pipeline smoke tests passed.`
3. Run the smoke test with an MP4 input (`bash scripts/pipeline-smoke-test.sh
   demo-videos/test-1.mp4`) to exercise the fast-path branch that remains
   inline — all checks must pass identically.

## Other Notes

- This is a pure refactor — no new features, no API changes, no new
  dependencies. The git diff should show only `src/workflow.ts` as modified.
- The helpers are `private` methods on the class (not module-level functions)
  because they access `this.env` for the D1 and R2 bindings. Keeping them on
  the class avoids passing `env` as an extra parameter and maintains the
  existing encapsulation.
- Inline comments within `run()` that explain *why* a step exists (e.g. the
  fast-path rationale, retry reasoning) should be preserved or condensed — do
  not silently delete architectural context.
