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
   *
   * @param id - The UUID of the video to play.
   */
  onPlay: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dashboard component that fetches and displays all uploaded videos as a
 * responsive grid of {@link VideoCard} elements.
 *
 * On mount the component calls `GET /api/videos` via {@link fetchVideos} and
 * populates the grid.  While the initial request is in flight, four
 * {@link VideoCardSkeleton} placeholders are rendered to prevent layout shift.
 * If the fetch fails, an inline error message is shown instead.
 *
 * Note: this component fetches once on mount.  Automatic status polling is
 * implemented in ISSUE-23; until then, users must refresh the page to see
 * updated statuses.
 *
 * @param props - See {@link VideoListProps}.
 * @returns A responsive `grid` of `VideoCard` components or skeleton
 *   placeholders, wrapped in a labelled section.
 *
 * @example
 * ```tsx
 * // In App.tsx
 * <VideoList onPlay={(id) => setSelectedVideoId(id)} />
 * ```
 */
function VideoList({ onPlay }: VideoListProps) {
  const [videos, setVideos] = useState<VideoResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchVideos()
      .then((data) => {
        if (!cancelled) {
          setVideos(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load videos",
          );
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
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
