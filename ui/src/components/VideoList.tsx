import { useEffect, useState } from "react";
import type { VideoResource } from "@/api";
import { fetchVideos } from "@/api";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import VideoCard from "@/components/VideoCard";

// ---------------------------------------------------------------------------
// Polling interval constants
// ---------------------------------------------------------------------------

/**
 * Polling interval in milliseconds while any video has an in-progress status
 * (`uploading`, `processing`, `transcoding`, `extracting_audio`, `grayscaling`).
 * Provides near-real-time feedback without excessive API load.
 */
const POLL_INTERVAL_ACTIVE = 3_000;

/**
 * Polling interval in milliseconds when all videos are `complete` or `error`.
 * Reduces unnecessary API calls during idle periods.
 */
const POLL_INTERVAL_IDLE = 30_000;

// ---------------------------------------------------------------------------
// Skeleton placeholder (matches VideoCard structure)
// ---------------------------------------------------------------------------

/**
 * A skeleton placeholder card shown while the initial video list is loading.
 *
 * Mimics the dimensions of a {@link VideoCard} so the layout does not jump
 * when real data arrives.  Uses shadcn `Skeleton` for the animated pulse
 * effect rather than a custom `animate-pulse` `div`.
 *
 * @returns A `Card` element with skeleton content in header, body, and footer.
 */
function VideoCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        {/* Filename title */}
        <Skeleton className="h-4 w-3/4" />
        {/* Status badge */}
        <Skeleton className="h-5 w-16" />
      </CardHeader>
      <CardContent>
        {/* Date line */}
        <Skeleton className="h-4 w-1/3" />
      </CardContent>
      <CardFooter>
        {/* Play button */}
        <Skeleton className="h-7 w-16" />
      </CardFooter>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Number of skeleton cards shown during the initial load
// ---------------------------------------------------------------------------

/**
 * Stable keys for the skeleton placeholder cards.  Using fixed string keys
 * rather than array indices avoids the `noArrayIndexKey` lint rule — the order
 * never changes so the keys are semantically stable.
 */
const SKELETON_KEYS = ["sk-0", "sk-1", "sk-2", "sk-3"] as const;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props accepted by {@link VideoList}.
 */
interface VideoListProps {
  /**
   * Callback invoked when the user clicks the "Play" button on a card.
   * The parent component uses this to open the video player (ISSUE-22).
   * The full {@link VideoResource} is passed so the parent can access
   * `play_url` directly without an additional lookup.
   *
   * @param video - The video record to play.
   */
  onPlay: (video: VideoResource) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dashboard component that fetches and displays all uploaded videos as a
 * responsive grid of {@link VideoCard} elements, with automatic status polling.
 *
 * **Polling behaviour**: On mount the component immediately calls
 * `GET /api/videos` via {@link fetchVideos}.  After each response the next
 * poll is scheduled with `setTimeout` (not `setInterval`) so requests never
 * stack — each poll waits for the previous one to complete before scheduling
 * the next.  The interval is dynamic:
 *
 * - **{@link POLL_INTERVAL_ACTIVE} ms (3 s)** while any video has an
 *   in-progress status (`uploading`, `processing`, `transcoding`,
 *   `extracting_audio`, `grayscaling`).
 * - **{@link POLL_INTERVAL_IDLE} ms (30 s)** when all videos are `complete`
 *   or `error`.
 *
 * While the initial request is in flight, four {@link VideoCardSkeleton}
 * placeholders are rendered to prevent layout shift.  If the initial fetch
 * fails, an inline error message is shown.  Errors on subsequent polls are
 * silently swallowed — a toast notification is planned for a future issue.
 *
 * The polling timer is torn down on component unmount via the `useEffect`
 * cleanup function.  Newly uploaded videos appear automatically on the next
 * poll cycle (within 3 s while any video is in-progress).
 *
 * @param props - See {@link VideoListProps}.
 * @returns A responsive `grid` of `VideoCard` components or skeleton
 *   placeholders, wrapped in a labelled section.
 *
 * @example
 * ```tsx
 * // In App.tsx
 * <VideoList onPlay={(video) => setSelectedVideo(video)} />
 * ```
 */
function VideoList({ onPlay }: VideoListProps) {
  const [videos, setVideos] = useState<VideoResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    /**
     * Tracks whether the first poll has completed.  Used to transition the
     * initial loading state and to decide whether errors should be surfaced
     * (initial load errors are shown; subsequent errors are silent).
     */
    let isFirstPoll = true;

    async function poll() {
      // Holds the fetched videos for this cycle; used to compute the next
      // poll interval even when the fetch fails (empty array → idle interval).
      let current: VideoResource[] = [];

      try {
        current = await fetchVideos();

        if (active) {
          setVideos(current);
          if (isFirstPoll) {
            setLoading(false);
            isFirstPoll = false;
          }
        }
      } catch (err: unknown) {
        if (active && isFirstPoll) {
          setError(
            err instanceof Error ? err.message : "Failed to load videos",
          );
          setLoading(false);
          isFirstPoll = false;
        }
        // Silently continue polling on subsequent errors — show toast in future
      }

      if (!active) return;

      // Switch to a fast interval while any video is still being processed.
      const hasInProgress = current.some(
        (v) => !["complete", "error"].includes(v.status),
      );
      const delay = hasInProgress ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE;
      timeoutId = setTimeout(poll, delay);
    }

    void poll(); // Fire initial fetch immediately

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, []);

  return (
    <section aria-label="Video dashboard">
      <h2 className="mb-4 text-xl font-semibold">Your Videos</h2>

      {error !== null && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {!error && loading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SKELETON_KEYS.map((key) => (
            <VideoCardSkeleton key={key} />
          ))}
        </div>
      )}

      {!loading && !error && videos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No videos yet. Upload one above to get started.
        </p>
      )}

      {!loading && !error && videos.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} onPlay={onPlay} />
          ))}
        </div>
      )}
    </section>
  );
}

export default VideoList;
