import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Vite configuration for the Video Processing Pipeline React SPA.
 *
 * Builds the React app into `../public/` so the Cloudflare Worker can serve
 * it as static assets via the ASSETS binding.  `emptyOutDir: true` ensures
 * stale build artefacts are removed on each build.
 *
 * The `@` path alias is mapped to `./src` so shadcn/ui components and other
 * source modules can be imported without brittle relative paths.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
});
