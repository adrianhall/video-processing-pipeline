# Issue 23 — Status Polling

## Summary

Add automatic polling to the `VideoList` component so that video statuses update in real-time. The polling interval is dynamic: fast (3 seconds) when any video is in-progress, slow (30 seconds) when all are complete or errored.

## Relevant Skills

- `vercel-react-best-practices`
- `react-state-management`

## Dependencies

- ISSUE-10 (status API endpoint)
- ISSUE-21 (VideoList component to add polling to)

## Acceptance Criteria

- [ ] `VideoList` polls `GET /api/videos` on an interval using `useEffect` + `setInterval`
- [ ] Polling interval is **3 seconds** while any video has an in-progress status (`uploading`, `processing`, `transcoding`, `extracting_audio`, `grayscaling`)
- [ ] Polling interval switches to **30 seconds** when all videos are `complete` or `error`
- [ ] The interval is cleaned up on component unmount (`useEffect` return function)
- [ ] The polling does not stack (new fetch waits for previous to complete, or uses a guard)
- [ ] Newly uploaded videos (from `UploadZone`) appear in the list after the next poll cycle
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `ui/src/components/VideoList.tsx` | Modified | Add polling logic with dynamic interval |

## Technical Implementation

### Polling with Dynamic Interval

```typescript
useEffect(() => {
  let timeoutId: ReturnType<typeof setTimeout>;
  let active = true;

  async function poll() {
    try {
      const videos = await fetchVideos();
      if (active) setVideos(videos);
    } catch {
      // Silently continue polling on error — show toast in future
    }

    if (!active) return;

    const hasInProgress = videos.some((v) =>
      !["complete", "error"].includes(v.status)
    );
    const delay = hasInProgress ? 3000 : 30000;
    timeoutId = setTimeout(poll, delay);
  }

  poll(); // Initial fetch

  return () => {
    active = false;
    clearTimeout(timeoutId);
  };
}, []);
```

Using `setTimeout` recursively instead of `setInterval` avoids stacking — each poll waits for the previous response before scheduling the next.

### Integration with UploadZone

When a new upload completes (`POST /api/videos/:id/process` succeeds), the upload zone can trigger an immediate refresh by calling a callback passed from `App.tsx`, or the polling will pick it up within 3 seconds. The simpler approach (let polling handle it) is preferred for this demo.

## Manual Tests

1. Run `npm run build` — succeeds
2. Run `npm start` — video list refreshes automatically (visible in network tab: periodic `GET /api/videos` calls)
3. Run `npm run check` — passes

## Other Notes

The polling approach is chosen over WebSockets for simplicity — this is a blog demo. For production, consider Server-Sent Events or WebSocket via Durable Objects for real-time updates. The 3-second interval provides near-real-time feedback without excessive API load.
