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
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/workflow.ts` | Added | VideoProcessingWorkflow class with register step and step placeholders |
| `src/index.ts` | Modified | Re-export VideoProcessingWorkflow |

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

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `src/workflow.ts` — class has detailed JSDoc, step 1 is implemented, steps 2–6 are commented placeholders
3. Inspect `src/index.ts` — exports both `VideoProcessingWorkflow` and `FFmpegContainer`

## Other Notes

This is the **most important file in the project** from a blog perspective. The code must be clean, linear, and readable. Every step should have a comment explaining what it does and why. Avoid abstractions that obscure the flow — a reader should be able to understand the entire pipeline by reading this one file top to bottom.
