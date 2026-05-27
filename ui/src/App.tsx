import UploadZone from "@/components/UploadZone";

/**
 * Root application component.
 *
 * Renders the top-level shell for the Video Processing Pipeline SPA,
 * including the page heading and the drag-and-drop upload zone.
 * Additional components (video dashboard, video player) will be added in
 * ISSUE-21 and ISSUE-22.
 *
 * @returns The application shell containing the upload zone.
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
  return (
    <main className="container mx-auto flex flex-col gap-8 p-8">
      <h1 className="text-3xl font-bold">Video Processing Pipeline</h1>
      <UploadZone />
    </main>
  );
}

export default App;
