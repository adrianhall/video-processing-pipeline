import { lazy, Suspense, useState } from "react";

import type { VideoResource } from "@/api";
import UploadZone from "@/components/UploadZone";
import VideoList from "@/components/VideoList";

// ---------------------------------------------------------------------------
// Lazy-loaded VideoPlayer
// ---------------------------------------------------------------------------

/**
 * Lazy-loaded `VideoPlayer` component.  The Dialog + `<video>` element chunk
 * is only downloaded when the user first clicks "Play", keeping the initial
 * JS bundle smaller for users who never play a video.
 *
 * Uses a default export from `VideoPlayer.tsx` so the standard
 * `React.lazy(() => import(...))` pattern works without the
 * `.then(m => ({ default: m.VideoPlayer }))` workaround.
 */
const VideoPlayer = lazy(() => import("./components/VideoPlayer"));

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

/**
 * Root application component.
 *
 * Renders the top-level shell for the Video Processing Pipeline SPA,
 * including the page heading, the drag-and-drop upload zone, and the video
 * dashboard.  Holds the `selectedVideo` state: when a video is selected for
 * playback (by clicking "Play" on a {@link VideoCard}), the `VideoPlayer`
 * dialog is rendered via a `Suspense` boundary.
 *
 * Layout: a full-width container with a vertical flex stack and consistent
 * `gap-8` spacing between major sections.
 *
 * @returns The application shell.
 *
 * @example
 * ```tsx
 * // In main.tsx
 * ReactDOM.createRoot(root).render(
 *   <React.StrictMode>
 *     <App />
 *   </React.StrictMode>
 * );
 * ```
 */
function App() {
  /**
   * The full `VideoResource` currently selected for playback, or `null` when
   * no video is playing.  Set via the `onPlay` callback on `VideoList` /
   * `VideoCard` when the user clicks "Play" on a completed video.  Cleared
   * by `VideoPlayer`'s `onClose` callback when the dialog is dismissed.
   */
  const [selectedVideo, setSelectedVideo] = useState<VideoResource | null>(
    null,
  );

  return (
    <main className="container mx-auto flex flex-col gap-8 p-8">
      <h1 className="text-3xl font-bold">Video Processing Pipeline</h1>
      <UploadZone />
      <VideoList onPlay={setSelectedVideo} />
      {selectedVideo?.play_url && (
        <Suspense fallback={null}>
          <VideoPlayer
            playUrl={selectedVideo.play_url}
            onClose={() => setSelectedVideo(null)}
          />
        </Suspense>
      )}
    </main>
  );
}

export default App;
