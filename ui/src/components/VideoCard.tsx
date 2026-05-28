import { Play } from "lucide-react";

import type { VideoResource, VideoStatus } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// ---------------------------------------------------------------------------
// Helpers (module-level for stable references)
// ---------------------------------------------------------------------------

/**
 * Maps a pipeline {@link VideoStatus} value to the appropriate shadcn `Badge`
 * variant, following the status badge variant table in PLAN.md.
 *
 * | Status | Variant |
 * |---|---|
 * | `complete` | `"default"` (success, filled primary) |
 * | `error` | `"destructive"` (failure, red) |
 * | `uploading` | `"outline"` (neutral, user action in progress) |
 * | all processing states | `"secondary"` (active, pipeline working) |
 *
 * @param status - The current pipeline status of the video.
 * @returns A shadcn badge variant string.
 */
function getStatusBadgeVariant(
  status: VideoStatus,
): "default" | "destructive" | "outline" | "secondary" {
  switch (status) {
    case "complete":
      return "default";
    case "error":
      return "destructive";
    case "uploading":
      return "outline";
    default:
      return "secondary"; // processing, transcoding, extracting_audio, grayscaling
  }
}

/**
 * Returns a human-readable label for a pipeline status value, converting
 * underscore-separated identifiers to title-case words.
 *
 * @param status - The current pipeline status.
 * @returns A short, display-ready label (e.g. `"Extracting Audio"`).
 */
function getStatusLabel(status: VideoStatus): string {
  switch (status) {
    case "uploading":
      return "Uploading";
    case "processing":
      return "Processing";
    case "transcoding":
      return "Transcoding";
    case "extracting_audio":
      return "Extracting Audio";
    case "grayscaling":
      return "Grayscaling";
    case "complete":
      return "Complete";
    case "error":
      return "Error";
  }
}

/**
 * Formats an ISO 8601 timestamp as a locale-aware short date string, e.g.
 * `"May 27, 2025"`.  Falls back to the raw string if parsing fails.
 *
 * @param isoString - An ISO 8601 date-time string (e.g. `"2025-05-27T10:00:00.000Z"`).
 * @returns A human-readable short date.
 */
function formatDate(isoString: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
      new Date(isoString),
    );
  } catch {
    return isoString;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Props accepted by {@link VideoCard}.
 */
interface VideoCardProps {
  /**
   * The video record to display.  All fields except `play_url` and
   * `error_message` are required to render a complete card.
   */
  video: VideoResource;
  /**
   * Callback invoked when the user clicks the "Play" button.
   * Called with the full {@link VideoResource} so the parent can open the
   * player with the correct `play_url` without an additional lookup.
   * Only invokable when `video.status === "complete"` and
   * `video.play_url` is non-null.
   *
   * @param video - The video record whose `play_url` should be played.
   */
  onPlay: (video: VideoResource) => void;
}

/**
 * Displays a single video's metadata and processing status as a shadcn `Card`.
 *
 * Shows the original filename (truncated with an ellipsis if it overflows),
 * a colored status badge that reflects the current pipeline stage, the
 * upload date, and a "Play" button.  The Play button is only enabled when
 * `video.status === "complete"` and `video.play_url` is non-null.
 *
 * When the video is in an error state, the card's title attribute contains
 * the `error_message` for quick inspection via hover tooltip.
 *
 * @param props - See {@link VideoCardProps}.
 * @returns A shadcn `Card` element representing one video in the dashboard.
 *
 * @example
 * ```tsx
 * <VideoCard
 *   video={myVideo}
 *   onPlay={(video) => setSelectedVideo(video)}
 * />
 * ```
 */
function VideoCard({ video, onPlay }: VideoCardProps) {
  const canPlay = video.status === "complete" && video.play_url !== null;

  return (
    <Card
      title={
        video.status === "error" && video.error_message
          ? video.error_message
          : undefined
      }
    >
      <CardHeader>
        <CardTitle className="truncate">{video.filename}</CardTitle>
        <CardAction>
          <Badge variant={getStatusBadgeVariant(video.status)}>
            {getStatusLabel(video.status)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {formatDate(video.created_at)}
        </p>
      </CardContent>
      <CardFooter>
        <Button
          size="sm"
          variant="default"
          disabled={!canPlay}
          onClick={() => {
            if (canPlay) onPlay(video);
          }}
        >
          <Play data-icon="inline-start" />
          Play
        </Button>
      </CardFooter>
    </Card>
  );
}

export default VideoCard;
