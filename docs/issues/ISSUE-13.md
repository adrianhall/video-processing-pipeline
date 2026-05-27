# Issue 13 — FFmpegContainer Class

## Summary

Create the `FFmpegContainer` class that acts as the Cloudflare Container definition in the Worker. This class extends `Container` and configures how the container starts, stops, and responds to health checks. The Workflow uses this class to get a named container instance and call its HTTP endpoints.

## Relevant Skills

- `cloudflare`
- `workers-best-practices`
- `wrangler`

## Dependencies

- ISSUE-03 (wrangler template with `containers` binding)
- ISSUE-12 (Flask server that the container runs)

## Acceptance Criteria

- [ ] `src/container.ts` exports an `FFmpegContainer` class that extends `Container`
- [ ] The class configures `sleepAfter` to auto-stop after 60 seconds of inactivity
- [ ] The class overrides `defaultPort()` to return 8080
- [ ] The class is exported from `src/index.ts` (required for Wrangler to find the class)
- [ ] The `class_name` matches `FFmpegContainer` — consistent with `wrangler.jsonc.tpl` from ISSUE-03
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/container.ts` | Added | FFmpegContainer class extending Container |
| `src/index.ts` | Modified | Re-export FFmpegContainer |

## Technical Implementation

### `src/container.ts`

```typescript
import { Container } from "cloudflare:workers";

export class FFmpegContainer extends Container {
  defaultPort(): number {
    return 8080;
  }

  override sleepAfter(): number {
    return 60; // seconds of inactivity before auto-stop
  }
}
```

### Export from index.ts

The container class must be exported from the Worker entry point so Wrangler can discover it:

```typescript
export { FFmpegContainer } from "./container";
```

### Container Usage Pattern (Reference)

The Workflow (ISSUE-15+) will use the container like this:

```typescript
const container = this.env.FFMPEG_CONTAINER.getByName(videoId);
// Wait for container to be ready
const resp = await container.fetch("http://container/transcode", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ input_url, output_url }),
});
```

The `getByName(videoId)` call creates a named instance per video, enabling parallel processing. The `sleepAfter(60)` means the container shuts down after 60 seconds of no HTTP requests, keeping costs down.

## Manual Tests

1. Run `npm run check` — passes
2. Inspect `src/container.ts` — class extends `Container`, overrides `defaultPort()` and `sleepAfter()`
3. Inspect `src/index.ts` — `FFmpegContainer` is re-exported

## Other Notes

The Container API is in beta. The exact base class and method signatures may change. Consult the latest Cloudflare Containers documentation if the build fails.
