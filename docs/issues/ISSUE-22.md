# Issue 22 — Video Player Component

## Summary

Implement the `VideoPlayer` component that plays completed videos in a dialog
overlay using a native HTML5 `<video>` element loaded from the authenticated
Worker streaming endpoint (`GET /api/videos/:id/stream`). The player is
lazy-loaded since the dialog is only needed when a user clicks "Play".

No third-party player library is required — H.264/AAC MP4 (the output of the
grayscale step) plays natively in all modern browsers. Cloudflare Stream and
`@cloudflare/stream-react` are **not used**; see `docs/DECISIONS.md` (ISSUE-18)
for the full rationale.

## Relevant Skills

- `shadcn`
- `vercel-react-best-practices`

## Dependencies

- ISSUE-18 (pipeline produces `bwvideo/{id}.mp4` in R2; API exposes `play_url`)
- ISSUE-19 (React + Vite build pipeline)

## Acceptance Criteria

- [ ] `ui/src/components/VideoPlayer.tsx` renders a `Dialog` containing a native `<video>` element
- [ ] The component accepts a `playUrl` (the `play_url` from `VideoResource`) and an `onClose` callback
- [ ] The `<video>` element uses `controls`, `autoPlay`, and `className="w-full rounded"` for basic styling
- [ ] The component is lazy-loaded in `App.tsx` using `React.lazy()`
- [ ] The `Dialog` has a `DialogTitle` (required for accessibility — can be `sr-only`)
- [ ] When `selectedVideoId` is set in `App.tsx`, the dialog opens with the player
- [ ] When the dialog is closed, `selectedVideoId` is set back to `null`
- [ ] Required shadcn components are installed: `dialog`
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `ui/src/components/VideoPlayer.tsx` | Added | HTML5 `<video>` in a Dialog |
| `ui/src/App.tsx` | Modified | Lazy-load VideoPlayer, pass `play_url` as `playUrl` prop |

## Technical Implementation

### VideoPlayer Component

```tsx
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface VideoPlayerProps {
  /** Worker-relative URL from VideoResource.play_url, e.g. /api/videos/{id}/stream */
  playUrl: string;
  onClose: () => void;
}

export function VideoPlayer({ playUrl, onClose }: VideoPlayerProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogTitle className="sr-only">Video Player</DialogTitle>
        <video
          src={playUrl}
          controls
          autoPlay
          className="w-full rounded"
        />
      </DialogContent>
    </Dialog>
  );
}
```

### Lazy Loading in App.tsx

```tsx
const VideoPlayer = React.lazy(() => import("./components/VideoPlayer"));

// In JSX:
{selectedVideo?.play_url && (
  <Suspense fallback={null}>
    <VideoPlayer
      playUrl={selectedVideo.play_url}
      onClose={() => setSelectedVideo(null)}
    />
  </Suspense>
)}
```

### Why HTML5 `<video>` is sufficient

- The output is H.264/AAC MP4 — natively supported by Chrome, Firefox, Safari, Edge, and mobile browsers.
- The streaming endpoint (`GET /api/videos/:id/stream`) supports HTTP Range requests, so browsers can seek without downloading the whole file.
- No player SDK bundle weight — the `<video>` element is built into the browser.

### Dialog Accessibility

shadcn/ui requires `DialogTitle` in every `Dialog` for accessibility. Since the
player dialog doesn't need a visible title, use `className="sr-only"` to hide it
visually while keeping it accessible to screen readers.

## Manual Tests

1. Run `npm run build` — succeeds
2. Run `npm run check` — passes
3. Upload a video via `npm start`, wait for `complete` status, click Play
4. Video plays without buffering issues; seek bar works

## Other Notes

The `play_url` is a relative path (`/api/videos/{id}/stream`). In development
(`npm start`) the Worker serves it on `http://localhost:8787`. In production the
Worker serves it on the same origin as the deployed app. No CORS configuration
is needed since the player and the streaming endpoint share the same origin.
