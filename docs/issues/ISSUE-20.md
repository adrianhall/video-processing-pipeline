# Issue 20 — Upload Zone Component

## Summary

Implement the `UploadZone` component: a drag-and-drop area that accepts video files, queues them, uploads each to R2 via presigned URLs, and triggers the processing workflow. This is the primary user interaction component.

## Relevant Skills

- `shadcn`
- `vercel-react-best-practices`
- `vercel-composition-patterns`
- `web-component-design`
- `tailwind-design-system`

## Dependencies

- ISSUE-08 (upload API endpoints that this component calls)
- ISSUE-19 (React + Vite build pipeline)

## Acceptance Criteria

- [ ] `ui/src/api.ts` implements API client functions: `createVideo(filename)` and `startProcessing(id)`
- [ ] `ui/src/components/UploadZone.tsx` renders a drag-and-drop zone using shadcn `Card`, `Button`, `Progress`, and `Badge`
- [ ] The component accepts video files via drag-and-drop and via a file picker button
- [ ] Dropped files are added to a local upload queue (`useState<UploadItem[]>`)
- [ ] Each file in the queue is processed sequentially: `POST /api/videos` → XHR PUT to presigned URL → `POST /api/videos/:id/process`
- [ ] Upload progress is tracked per-file using XHR `upload.onprogress` (not `fetch`)
- [ ] Each queue item shows: filename, progress bar, status badge (queued/uploading/processing/done/error)
- [ ] Upload errors are shown inline on the failed item with a `destructive` badge
- [ ] Required shadcn components are installed: `card`, `button`, `progress`, `badge`
- [ ] The component is imported and rendered in `App.tsx`
- [ ] `npm run check` passes
- [ ] `npm run build` succeeds

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `ui/src/api.ts` | Modified | Add `createVideo()` and `startProcessing()` API client functions |
| `ui/src/components/UploadZone.tsx` | Added | Drag-and-drop upload component |
| `ui/src/App.tsx` | Modified | Import and render UploadZone |

## Technical Implementation

### API Client (`ui/src/api.ts`)

```typescript
const API_BASE = "/api";

export async function createVideo(filename: string): Promise<{ id: string; upload_url: string }> {
  const res = await fetch(`${API_BASE}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename }),
  });
  if (!res.ok) throw new Error(`Failed to create video: ${res.status}`);
  const json = await res.json();
  return json.data;
}

export async function startProcessing(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/videos/${id}/process`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to start processing: ${res.status}`);
}
```

### XHR Upload (Required for Progress)

`fetch()` does not support upload progress events. Use `XMLHttpRequest` for the PUT to the presigned URL:

```typescript
function uploadFile(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.open("PUT", url);
    xhr.send(file);
  });
}
```

### Drag-and-Drop

Use the native HTML5 drag-and-drop API (`onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop`). Filter to video MIME types (`video/*`). Show a visual indicator when files are being dragged over the zone.

### shadcn Styling Rules

- Use `gap-*` not `space-y-*` for vertical stacks
- Use `Badge` with `variant="destructive"` for errors, `variant="secondary"` for in-progress
- Use `size-*` when width and height are equal
- Import components directly (no barrel imports)

## Manual Tests

1. Run `npm run build` — succeeds
2. Run `npm start` — the upload zone is visible on the page with drag-and-drop area and file picker button
3. Run `npm run check` — passes

## Other Notes

The upload flow won't actually work until the backend is deployed with real R2 presigned URLs. For local development, the upload API will return presigned URLs that may not be valid. The UI should handle errors gracefully.
