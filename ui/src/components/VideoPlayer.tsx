import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Props accepted by {@link VideoPlayer}.
 */
interface VideoPlayerProps {
  /**
   * Worker-relative URL for the grayscale MP4 stream, e.g.
   * `/api/videos/{id}/stream`.  Comes from `VideoResource.play_url`.
   * The URL is relative to the current origin, so no CORS configuration is
   * needed — the player and the streaming endpoint share the same origin.
   */
  playUrl: string;
  /**
   * Called when the dialog is dismissed (backdrop click, Escape key, or the
   * built-in close button).  The parent should set its selected-video state
   * back to `null` to unmount this component.
   */
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Plays a completed grayscale video in a modal dialog using the native HTML5
 * `<video>` element.
 *
 * The player is lazy-loaded in `App.tsx` (`React.lazy`) so its module chunk is
 * only downloaded when the user first clicks "Play".  The dialog opens
 * immediately (controlled via `open={true}`) and closes via the
 * `onOpenChange` prop, which calls `onClose` whenever Radix signals that the
 * dialog should close (Escape key, backdrop click, or the X button).
 *
 * No third-party player library is required: the pipeline output is
 * H.264/AAC MP4, which every modern browser plays natively.  The Worker
 * streaming endpoint supports HTTP Range requests so the browser seek bar
 * works without buffering the entire file.
 *
 * @param props - See {@link VideoPlayerProps}.
 * @returns A Radix `Dialog` containing a full-width HTML5 `<video>` element.
 *
 * @example
 * ```tsx
 * // Lazy-load in App.tsx and render conditionally:
 * const VideoPlayer = React.lazy(() => import("./components/VideoPlayer"));
 *
 * {selectedVideo?.play_url && (
 *   <Suspense fallback={null}>
 *     <VideoPlayer
 *       playUrl={selectedVideo.play_url}
 *       onClose={() => setSelectedVideo(null)}
 *     />
 *   </Suspense>
 * )}
 * ```
 */
export function VideoPlayer({ playUrl, onClose }: VideoPlayerProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        {/*
         * DialogTitle is required by shadcn/ui for accessibility — every
         * Dialog must have a title so screen readers can announce the dialog.
         * The player dialog has no visible title, so sr-only hides it visually
         * while preserving it for assistive technology.
         */}
        <DialogTitle className="sr-only">Video Player</DialogTitle>
        {/*
         * biome-ignore lint/a11y/useMediaCaption: The pipeline produces
         * grayscale video output only — no caption track is generated.
         * A future enhancement could extract subtitles from the original
         * audio stream and attach them here via a <track> element.
         */}
        <video src={playUrl} controls autoPlay className="w-full rounded" />
      </DialogContent>
    </Dialog>
  );
}

export default VideoPlayer;
