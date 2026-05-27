# Issue 22 — Video Player Component

## Summary

Implement the `VideoPlayer` component that uses `@cloudflare/stream-react` to play completed videos in a dialog overlay. The player is lazy-loaded since the Stream SDK bundle is only needed when a user clicks "Play".

## Relevant Skills

- `shadcn`
- `vercel-react-best-practices`
- `cloudflare`

## Dependencies

- ISSUE-18 (workflow uploads to Stream — provides `stream_video_id`)
- ISSUE-19 (React + Vite build pipeline)

## Acceptance Criteria

- [ ] `@cloudflare/stream-react` is installed in `ui/`
- [ ] `ui/src/components/VideoPlayer.tsx` renders a `Dialog` containing the Stream `<Stream>` player component
- [ ] The component accepts a `videoId` (Stream video UID) and an `onClose` callback
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
| `ui/src/components/VideoPlayer.tsx` | Added | Stream player in a Dialog |
| `ui/src/App.tsx` | Modified | Lazy-load VideoPlayer, pass selectedVideoId |
| `ui/package.json` | Modified | Add `@cloudflare/stream-react` dependency |

## Technical Implementation

### VideoPlayer Component

```tsx
import { Stream } from "@cloudflare/stream-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface VideoPlayerProps {
  streamVideoId: string;
  onClose: () => void;
}

export function VideoPlayer({ streamVideoId, onClose }: VideoPlayerProps) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogTitle className="sr-only">Video Player</DialogTitle>
        <Stream controls src={streamVideoId} />
      </DialogContent>
    </Dialog>
  );
}
```

### Lazy Loading in App.tsx

```tsx
const VideoPlayer = React.lazy(() => import("./components/VideoPlayer"));

// In JSX:
{selectedVideoId && (
  <Suspense fallback={null}>
    <VideoPlayer
      streamVideoId={selectedVideoId}
      onClose={() => setSelectedVideoId(null)}
    />
  </Suspense>
)}
```

This ensures the Stream SDK bundle is only loaded when a user clicks Play, reducing the initial bundle size.

### Dialog Accessibility

shadcn/ui requires `DialogTitle` in every `Dialog` for accessibility. Since the player dialog doesn't need a visible title, use `className="sr-only"` to hide it visually while keeping it accessible to screen readers.

## Manual Tests

1. Run `npm run build` — succeeds
2. Run `npm run check` — passes
3. Inspect `App.tsx` — `VideoPlayer` is lazy-loaded with `React.lazy`

## Other Notes

The player will only work with real Stream video UIDs from a deployed environment. In local development, the dialog will open but the Stream player may show an error if the video UID is invalid. This is expected.
