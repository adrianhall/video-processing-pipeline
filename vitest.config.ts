/**
 * Vitest multi-project configuration for the Video Processing Pipeline.
 *
 * Four test projects are declared up-front so the project shape is correct
 * before any individual suite grows:
 *
 * | Project       | Runtime                        | Source              | Status      |
 * |---------------|--------------------------------|---------------------|-------------|
 * | `worker`      | Cloudflare Workers (miniflare) | `tests/worker`      | Implemented |
 * | `ui`          | jsdom + React Testing Library  | `tests/ui`          | Implemented |
 * | `container`   | Node.js HTTP client            | `tests/container`   | Placeholder |
 * | `integration` | Node.js full-stack             | `tests/integration` | Placeholder |
 *
 * ## D1 migration setup
 *
 * `readD1Migrations` reads the migration files at config time (Node.js
 * context — full host filesystem access).  The parsed `D1Migration[]` is
 * injected into the worker project's test context via `provide`, then
 * applied in `tests/worker/setup.ts` using `applyD1Migrations`.  This
 * avoids the miniflare virtual filesystem limitation that blocks a direct
 * `readFileSync` call from within the Workers runtime.
 *
 * ## Coverage
 *
 * Istanbul is used instead of V8 because workerd (the Cloudflare Workers
 * runtime used by miniflare) does not expose V8 profiler data.  Istanbul
 * instruments source files at transpile time so coverage counters reach all
 * four runtimes uniformly.
 *
 * @module vitest.config
 */

import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Read D1 migration files at config time (Node.js context — not inside
// miniflare's virtual FS).  The result is injected into the worker test
// project so setup.ts can call applyD1Migrations(env.DB, inject("migrations")).
const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  test: {
    /**
     * Istanbul coverage provider — runtime-agnostic instrumentation.
     *
     * V8 coverage (`@vitest/coverage-v8`) relies on the V8 engine's native
     * profiler.  Workerd does not expose that profiler, so V8 coverage reports
     * 0 % for Worker code.  Istanbul instruments at transpile time (Babel
     * transform), making it runtime-agnostic.
     *
     * `src/workflow.ts` and `src/container.ts` are excluded because testing
     * them requires full Workflow execution and Docker container calls, which
     * are not supported in unit tests.  They belong in the `container` and
     * `integration` suites (future issues).
     */
    coverage: {
      provider: "istanbul",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}", "ui/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        // Excluded until container/integration suites are implemented.
        "src/workflow.ts",
        "src/container.ts",
      ],
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 75,
        statements: 75,
      },
    },
    projects: [
      /**
       * Worker project — runs inside the Cloudflare Workers runtime via
       * miniflare.  Uses the committed `wrangler.test.jsonc` so tests are
       * self-contained: no real Cloudflare infrastructure or provisioned
       * `wrangler.jsonc` is required.
       *
       * `provide.migrations` makes the parsed D1 migration objects available
       * to `tests/worker/setup.ts` via `inject("migrations")`.
       *
       * NOTE: Never set `test.environment` here.  The `cloudflareTest()`
       * plugin owns the runner pool and sets the Workers environment itself.
       * Adding an explicit `environment` overrides the pool and silently
       * breaks the Workers binding context.
       */
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.test.jsonc" },
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          setupFiles: ["tests/worker/setup.ts"],
          provide: {
            /** Parsed D1 migration objects — consumed by tests/worker/setup.ts. */
            migrations,
          },
        },
      },
      /**
       * UI project — runs in jsdom with React Testing Library.
       *
       * The `@` alias mirrors the one in `ui/vite.config.ts` so imports like
       * `import VideoCard from "@/components/VideoCard"` resolve correctly
       * from both source files and test files.
       */
      {
        plugins: [react()],
        resolve: {
          // Resolve the `@` alias to the UI source tree, mirroring the alias
          // in ui/vite.config.ts so imports like `import X from "@/components/X"`
          // resolve correctly from both source files and test files.
          alias: { "@": path.resolve(__dirname, "ui/src") },
        },
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/ui/setup.ts"],
        },
      },
      /**
       * Container project — placeholder for future HTTP-level tests against
       * the Flask/ffmpeg container server.
       *
       * Tests will use a real Node.js HTTP client to call the container
       * endpoints.  Left as a placeholder now so `vitest run --project container`
       * works from day one without structural changes.
       */
      {
        test: {
          name: "container",
          environment: "node",
          include: ["tests/container/**/*.test.ts"],
        },
      },
      /**
       * Integration project — placeholder for full-stack tests that exercise
       * the Worker + D1 + R2 + Container pipeline end-to-end.
       *
       * Left as a placeholder now so `vitest run --project integration`
       * works from day one without structural changes.
       */
      {
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
