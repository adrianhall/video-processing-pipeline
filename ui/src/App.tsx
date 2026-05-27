import { useState } from "react";

import UploadZone from "@/components/UploadZone";
import VideoList from "@/components/VideoList";

/**
 * Root application component.
 *
 * Renders the top-level shell for the Video Processing Pipeline SPA,
 * including the page heading, the drag-and-drop upload zone, and the video
 * dashboard.  Holds the `selectedVideoId` state that will be passed to the
 * `VideoPlayer` component (added in ISSUE-22).
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
   * UUID of the video currently selected for playback, or `null` when no
   * video is selected.  Set via the `onPlay` callback on `VideoList` /
   * `VideoCard`.  Will be consumed by `VideoPlayer` in ISSUE-22.
   */
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);

  return (
    <main className="container mx-auto flex flex-col gap-8 p-8">
      <h1 className="text-3xl font-bold">Video Processing Pipeline</h1>
      <UploadZone />
      <VideoList onPlay={setSelectedVideoId} />
      {/* selectedVideoId is consumed by VideoPlayer (ISSUE-22) */}
      {selectedVideoId !== null && (
        <p className="sr-only">Selected video: {selectedVideoId}</p>
      )}
    </main>
  );
}

export default App;
