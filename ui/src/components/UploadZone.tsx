import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { createVideo, startProcessing } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Lifecycle status of a single item in the client-side upload queue.
 *
 * Transitions follow this path:
 * `queued` → `uploading` → `processing` → `done`
 * Any state can transition to `error` on failure.
 */
type UploadStatus = "queued" | "uploading" | "processing" | "done" | "error";

/**
 * A single entry in the upload queue managed by {@link UploadZone}.
 *
 * The `id` field is a browser-generated UUID and is distinct from the
 * server-assigned video ID returned by `POST /api/videos`.
 */
interface UploadItem {
  /** Browser-generated UUID used as the React list key. */
  id: string;
  /** The browser `File` object chosen by the user. */
  file: File;
  /**
   * Upload progress percentage in the range [0, 100].
   * Only meaningful while `status === "uploading"`.
   */
  progress: number;
  /** Current lifecycle status. */
  status: UploadStatus;
  /**
   * Human-readable error description.
   * Present only when `status === "error"`.
   */
  error?: string;
}

// ---------------------------------------------------------------------------
// Module-level helpers (defined outside the component for stable references)
// ---------------------------------------------------------------------------

/**
 * Returns the shadcn `Badge` variant that matches the given upload status.
 *
 * @param status - The current status of a queue item.
 * @returns A badge variant string suitable for the `variant` prop of `Badge`.
 */
function badgeVariant(
  status: UploadStatus,
): "outline" | "secondary" | "default" | "destructive" {
  switch (status) {
    case "queued":
      return "outline";
    case "uploading":
    case "processing":
      return "secondary";
    case "done":
      return "default";
    case "error":
      return "destructive";
  }
}

/**
 * Returns the human-readable label displayed in the status badge.
 *
 * @param status - The current status of a queue item.
 * @returns A short title-case label.
 */
function badgeLabel(status: UploadStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "uploading":
      return "Uploading";
    case "processing":
      return "Processing";
    case "done":
      return "Done";
    case "error":
      return "Error";
  }
}

/**
 * Uploads a `File` to a presigned R2 URL using `XMLHttpRequest`, which
 * provides `upload.onprogress` events unavailable with `fetch`.
 *
 * @param url - The presigned PUT URL returned by `POST /api/videos`.
 * @param file - The browser `File` object to upload.
 * @param onProgress - Callback invoked with a percentage in [0, 100] as bytes
 *   are transmitted.  Only called when `ProgressEvent.lengthComputable` is
 *   `true`.
 * @returns A promise that resolves when the server returns 2xx, or rejects on
 *   a non-2xx response or network error.
 */
function uploadViaXHR(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed: ${xhr.status}`));
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.open("PUT", url);
    xhr.send(file);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Drag-and-drop upload zone that accepts video files, queues them, and
 * processes each one sequentially through the full upload pipeline:
 * `POST /api/videos` → XHR PUT to presigned R2 URL → `POST /api/videos/:id/process`.
 *
 * Each file in the queue is displayed with its filename, a progress bar
 * (shown while uploading), and a status badge that transitions through
 * `queued` → `uploading` → `processing` → `done` (or `error` on failure).
 *
 * Files dropped while a previous upload is in progress are added to the queue
 * and processed in order once the current upload completes.
 *
 * @returns A shadcn `Card` containing the drag-and-drop area, a file picker
 *   button, and the upload queue list.
 *
 * @example
 * ```tsx
 * // Render in App.tsx
 * <UploadZone />
 * ```
 */
function UploadZone() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  // Hidden file input triggered by the "Choose files" button.
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A separate queue ref lets the processing loop always read the latest
  // pending items without relying on stale state closures.
  const pendingRef = useRef<UploadItem[]>([]);

  // Guards the processing loop against concurrent invocations.
  const isProcessingRef = useRef(false);

  /**
   * Safely updates a single item in the queue using functional setState.
   * This avoids stale-closure issues since React merges the previous state.
   *
   * @param id - The `UploadItem.id` of the item to update.
   * @param patch - Partial fields to merge onto the existing item.
   */
  function patchItem(id: string, patch: Partial<UploadItem>) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  /**
   * Drains `pendingRef` sequentially, processing one item at a time.
   * Called after every `addFiles()` invocation; the guard prevents re-entry.
   */
  async function runQueue() {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    while (pendingRef.current.length > 0) {
      // Shift the next item off the front of the pending list.
      const item = pendingRef.current.shift();
      if (!item) break;

      patchItem(item.id, { status: "uploading" });

      try {
        // Step 1: Register the video, obtain presigned PUT URL.
        const { id: videoId, upload_url } = await createVideo(item.file.name);

        // Step 2: Upload bytes directly to R2 via XHR (supports progress events).
        await uploadViaXHR(upload_url, item.file, (pct) => {
          patchItem(item.id, { progress: pct });
        });

        // Step 3: Mark upload complete, trigger the Workflow.
        patchItem(item.id, { status: "processing", progress: 100 });
        await startProcessing(videoId);

        patchItem(item.id, { status: "done" });
      } catch (err) {
        patchItem(item.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed",
        });
      }
    }

    isProcessingRef.current = false;
  }

  /**
   * Validates that all files are video MIME types, adds them to the display
   * queue and the pending processing queue, then starts the processing loop.
   *
   * @param files - Raw `File` array from a drop event or file-input change.
   */
  function addFiles(files: File[]) {
    const videoFiles = files.filter((f) => f.type.startsWith("video/"));
    if (videoFiles.length === 0) return;

    const newItems: UploadItem[] = videoFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: "queued" as UploadStatus,
    }));

    setItems((prev) => [...prev, ...newItems]);
    pendingRef.current.push(...newItems);
    void runQueue();
  }

  // -------------------------------------------------------------------------
  // Drag-and-drop handlers
  // -------------------------------------------------------------------------

  /** Prevents default browser behaviour (opening the file) on drag over. */
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  /** Shows the drag-over highlight when a drag enters the zone. */
  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }

  /**
   * Hides the drag-over highlight, but only when the pointer truly leaves the
   * container (not when it transitions to a child element).
   */
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  /** Receives dropped files, filters to video types, and enqueues them. */
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  /** Handles file selection via the hidden `<input type="file">`. */
  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(e.target.files ?? []));
    // Reset so the same file can be re-selected on subsequent picks.
    e.target.value = "";
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Videos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Drop zone */}
        <section
          aria-label="Video drop zone"
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-8 text-center transition-colors",
            isDragOver && "border-primary bg-primary/5",
          )}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Upload className="size-10 text-muted-foreground" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">Drop video files here</p>
            <p className="text-xs text-muted-foreground">
              MP4, WebM, AVI, MKV and more
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="sr-only"
            onChange={handleFileInput}
          />
        </section>

        {/* Upload queue */}
        {items.length > 0 && (
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-1.5 rounded-lg border border-border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{item.file.name}</span>
                  <Badge variant={badgeVariant(item.status)}>
                    {badgeLabel(item.status)}
                  </Badge>
                </div>
                {(item.status === "uploading" ||
                  item.status === "processing") && (
                  <Progress
                    value={item.status === "processing" ? 100 : item.progress}
                  />
                )}
                {item.status === "error" && item.error && (
                  <p className="text-xs text-destructive">{item.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default UploadZone;
