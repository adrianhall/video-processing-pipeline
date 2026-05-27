# Issue 21 — Video Dashboard Component

## Summary

Implement the `VideoList` and `VideoCard` components that display all uploaded videos with their current processing status. This is the main dashboard view.

## Relevant Skills

- `shadcn`
- `vercel-react-best-practices`
- `vercel-composition-patterns`
- `web-component-design`
- `tailwind-design-system`

## Dependencies

- ISSUE-09 (video list API endpoint)
- ISSUE-19 (React + Vite build pipeline)

## Acceptance Criteria

- [ ] `ui/src/api.ts` adds a `fetchVideos()` function that calls `GET /api/videos`
- [ ] `ui/src/components/VideoCard.tsx` renders a single video's info: filename, status badge (colored per status), created date, and a "Play" button (disabled until `complete`)
- [ ] `ui/src/components/VideoList.tsx` fetches videos on mount, renders a grid of `VideoCard` components, shows `Skeleton` placeholders during initial load
- [ ] Status badges use the correct variant per status from PLAN.md's Frontend Design section
- [ ] The video list is displayed in `App.tsx` below the `UploadZone`
- [ ] Required shadcn components are installed: `skeleton` (if not already)
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `ui/src/api.ts` | Modified | Add `fetchVideos()` |
| `ui/src/components/VideoCard.tsx` | Added | Individual video status card |
| `ui/src/components/VideoList.tsx` | Added | Dashboard grid of video cards |
| `ui/src/App.tsx` | Modified | Add VideoList below UploadZone |

## Technical Implementation

### VideoCard

Each card shows:

- Filename (truncated if long)
- Status badge with variant based on status value
- `created_at` formatted as relative time or short date
- "Play" button — only enabled when `status === "complete"` and `stream_url` is non-null

### Status Badge Mapping

```typescript
function getStatusBadgeVariant(status: string) {
  switch (status) {
    case "complete": return "default";
    case "error": return "destructive";
    case "uploading": return "outline";
    default: return "secondary"; // all processing states
  }
}
```

### VideoList

- Fetch videos on mount with `useEffect` + `fetchVideos()`
- Store in `useState<VideoResource[]>([])`
- Show 3-4 `Skeleton` cards during initial load
- Render as a responsive CSS grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`

### App Integration

`App.tsx` should accept a callback from `VideoCard`'s "Play" button that sets the selected video ID in App state. This ID is passed to `VideoPlayer` (ISSUE-22).

```tsx
const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
```

## Manual Tests

1. Run `npm run build` — succeeds
2. Run `npm start` — dashboard shows below the upload zone (empty state or skeleton cards)
3. Run `npm run check` — passes

## Other Notes

Polling (auto-refresh) is not implemented here — that's ISSUE-23. The list fetches once on mount. The user must manually refresh to see status updates until ISSUE-23 adds polling.
