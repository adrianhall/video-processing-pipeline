import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * Application entry point.
 *
 * Mounts the React root at `#root`.  Throws if the element is missing rather
 * than silently failing — a missing `#root` always indicates a broken
 * `index.html` and should surface immediately.
 */
function main(): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error(
      "Root element #root not found in the DOM — check ui/index.html",
    );
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

main();
