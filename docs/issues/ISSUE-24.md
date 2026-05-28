# Issue 24 — Test Infrastructure and Tests

## Summary

Set up Vitest with a **multi-project configuration** (`vitest.config.ts`
`test.projects`) and `@vitest/coverage-istanbul`, then write the first
test suites for the Worker API and the React UI components.

Four projects are defined from the start so the shape is right before any
individual suite grows:

| Project | Runtime | Source location | Status |
|---------|---------|-----------------|--------|
| `worker` | Cloudflare Workers (miniflare) | `tests/worker` | Implemented |
| `ui` | jsdom + React Testing Library | `tests/ui` | Implemented |
| `container` | Node.js HTTP client | `tests/container` | Placeholder |
| `integration` | Node.js full-stack | `tests/integration/` | Placeholder |

**Note**: All tests are located in the `tests` directory and are completely
separate from the source files.

`npm run test:coverage` collects Istanbul coverage across all four projects
and enforces a 75% threshold on lines, functions, branches, and statements.

## Relevant Skills

- `cloudflare-auth`
- `workers-best-practices`
- `wrangler`
- `webapp-testing`

## Dependencies

- ISSUE-05 (Hono API with auth middleware)
- ISSUE-14 (Workflow scaffold — needed for the Workflow binding to exist)

## Acceptance Criteria

- [ ] `vitest.config.ts` exists at the project root using `test.projects`
      with four named projects (`worker`, `ui`, `container`, `integration`)
- [ ] Worker project uses the `cloudflareTest()` Vite plugin from
      `@cloudflare/vitest-pool-workers` (new API for vitest 4.x), pointing
      at `wrangler.test.jsonc`
- [ ] `wrangler.test.jsonc` is committed — a test-only wrangler config with
      fake placeholder credentials (no real infrastructure needed to run tests)
- [ ] Coverage is configured with `provider: "istanbul"` at the root level;
      V8 is explicitly not used because workerd does not expose V8 profiler
      data
- [ ] `@vitest/coverage-istanbul`, `@testing-library/react`,
      `@testing-library/jest-dom`, `@testing-library/user-event`,
      `@vitejs/plugin-react`, and `jsdom` are in root `devDependencies`
- [ ] `test` script runs `vitest run`; `test:coverage` runs
      `vitest run --coverage`
- [ ] `pretest` lifecycle hook runs `wrangler types --config wrangler.test.jsonc`
      so `worker-configuration.d.ts` is generated before tests compile
      (makes `npm test` self-contained without requiring `npm run provision`)
- [ ] `generate:types:test` script available for manual type regeneration
- [ ] `tests/worker/api.test.ts` — Worker API tests covering:
      - `GET /api/version` is public (200, no auth)
      - Protected routes redirect without credentials (302)
      - Authenticated routes return 200 with a `signDevJwt` token
      - Expired tokens are rejected (302)
      - `POST /api/videos` input validation (invalid JSON, missing/empty filename)
      - `POST /api/videos` happy path — 200 with `id` and presigned `upload_url`
      - Format derivation (mp4 → `"mp4"`, no extension → `"bin"`)
      - `GET /api/videos/:id` not-found (404)
      - `GET /api/videos/:id` found (200 with full `VideoResource`)
      - `GET /api/videos/:id/status` not-found (404)
      - `GET /api/videos/:id/status` no workflow started (400)
      - `GET /api/videos/:id/stream` not-found (404)
      - `GET /api/videos/:id/stream` no `r2_bw_key` (404, not ready)
      - `POST /api/videos/:id/process` not-found (404)
      - `POST /api/videos/:id/process` wrong status (400)
- [ ] `tests/ui/VideoCard.test.tsx` — component tests covering:
      - Filename and date rendering
      - Status badge label for every `VideoStatus` value
      - Play button disabled for all non-complete states
      - Play button disabled when `complete` but `play_url` is `null`
      - Play button enabled + calls `onPlay` with full `VideoResource`
      - Error state: card title contains `error_message`
- [ ] `tests/ui/api.test.ts` — API client tests covering:
      - `createVideo` POST URL, body, and parsed response
      - `createVideo` throws on non-2xx
      - `startProcessing` POST URL
      - `startProcessing` throws on non-2xx
      - `fetchVideos` GET URL and returned array
      - `fetchVideos` throws on non-2xx
- [ ] `tests/container/` and `tests/integration/` placeholder
      directories exist (`.gitkeep`)
- [ ] `npm test` passes with all tests green
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `vitest.config.ts` | Added | Multi-project config; 4 projects; Istanbul coverage |
| `wrangler.test.jsonc` | Added | Test wrangler config; fake credentials; committed |
| `tests/worker/tsconfig.json` | Added | Extends `src/tsconfig.json`; adds `@cloudflare/vitest-pool-workers/types` |
| `tests/worker/setup.ts` | Added | Applies D1 migrations via `env.DB.exec()` in `beforeAll` |
| `tests/worker/api.test.ts` | Added | Worker API tests (auth + CRUD) |
| `tests/ui/setup.ts` | Added | Imports `@testing-library/jest-dom` |
| `tests/ui/VideoCard.test.tsx` | Added | Component tests with `@testing-library/react` |
| `tests/ui/api.test.ts` | Added | API client tests (mocked `fetch`) |
| `tests/container/.gitkeep` | Added | Placeholder for future container tests |
| `tests/integration/.gitkeep` | Added | Placeholder for future integration tests |
| `package.json` | Modified | New devDependencies; `pretest`/`generate:types:test` scripts |
| `biome.json` | Modified | Add `!coverage` to `files.includes` exclusions |

## Technical Implementation

### Why four projects from the start

Vitest projects are declared at the `test.projects` level in the root
config.  Adding them now — even as empty placeholders — means:

- `npm run test -- --project worker` works from day one
- Coverage includes/excludes are correct from the first run
- Future suites (container, integration) slot in without structural changes

### Vitest project configuration

```typescript
// vitest.config.ts (sketch — see full file for JSDoc)
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "istanbul",       // not V8 — workerd doesn't expose profiler data
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}", "ui/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.d.ts",
        "src/workflow.ts",    // container suite (future)
        "src/container.ts",  // container suite (future)
      ],
      thresholds: { lines: 75, functions: 75, branches: 75, statements: 75 },
    },
    projects: [
      // Worker — cloudflareTest() plugin (new API, vitest 4.x)
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          setupFiles: ["tests/worker/setup.ts"],
          // NOTE: never set test.environment here — cloudflareTest owns the pool
        },
      },
      // UI — jsdom + React Testing Library
      {
        plugins: [react()],
        resolve: { alias: { "@": path.resolve(__dirname, "ui/src") } },
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/ui/setup.ts"],
        },
      },
      // Placeholders (container, integration) — empty include globs are fine
      { test: { name: "container", environment: "node", include: ["tests/container/**/*.test.ts"] } },
      { test: { name: "integration", environment: "node", include: ["tests/integration/**/*.test.ts"] } },
    ],
  },
});
```

### Why `cloudflareTest()` instead of `defineWorkersConfig`

`@cloudflare/vitest-pool-workers` 0.16+ (required by vitest 4.x) uses a
**Vite plugin API** (`cloudflareTest()`) rather than the older
`defineWorkersConfig` / `defineWorkersProject` helpers.  The new API
integrates with `defineConfig` → `test.projects` natively, so the worker
project is just another inline project config with `plugins`.

### `wrangler.test.jsonc` — standalone test config

`wrangler.jsonc` is gitignored (real credentials).  Tests would normally
require `npm run provision` to generate it.  Instead, a committed
`wrangler.test.jsonc` provides all the same binding declarations with
placeholder values:

- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`: valid-format hex strings
  (fake).  `generatePresignedUrl` uses HMAC-SHA256 locally — it never
  calls R2 — so any non-empty hex string produces a valid signed URL.
- `CLOUDFLARE_TEAM_DOMAIN`: a fake domain is sufficient because
  `cloudflareAccess` uses HMAC verification first (for `signDevJwt` tokens),
  and the JWKS fetch is never reached in unit tests.
- `containers[].image` is included but Docker is not started — miniflare
  registers `FFmpegContainer` as a stub DO without building the image.

### `pretest` and `generate:types:test`

`worker-configuration.d.ts` is generated from `wrangler.jsonc` (gitignored).
Without it, TypeScript can't resolve the `Env` interface.

Adding a `pretest` lifecycle hook that runs
`wrangler types --config wrangler.test.jsonc --strict-vars=false` generates a
structurally identical `worker-configuration.d.ts` from the test config
(no Cloudflare auth needed — `wrangler types` is a local-only operation).
`npm test` is therefore self-contained on a fresh checkout.

```json
{
  "pretest": "wrangler types --config wrangler.test.jsonc --strict-vars=false",
  "generate:types:test": "wrangler types --config wrangler.test.jsonc --strict-vars=false"
}
```

### Istanbul coverage rationale

V8 coverage (`@vitest/coverage-v8`) relies on the V8 engine's native
profiler.  Workerd (the Cloudflare Workers runtime used by miniflare) does
**not** expose V8 profiler data, so V8 coverage reports 0% for worker code.

Istanbul (`@vitest/coverage-istanbul`) instruments source files at transpile
time (Babel transform).  Coverage counters are injected into the JS before
it reaches any runtime, making it runtime-agnostic.  The same provider
correctly instruments both the Workers tests (via miniflare) and the jsdom
React tests.

### D1 migration setup in worker tests

Rather than using `readD1Migrations` + miniflare bindings injection (the
more complex approach from the Cloudflare docs), D1 is seeded by reading and
executing the migration SQL directly in `beforeAll`:

```typescript
// tests/worker/setup.ts
import { readFileSync } from "node:fs";
import { env } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  const sql = readFileSync("migrations/0001_init.sql", "utf-8");
  // D1Database.exec() handles multi-statement SQL; IF NOT EXISTS guards
  // make it re-entrant across test runs.
  await env.DB.exec(sql);
});
```

### Test pattern with signDevJwt

```typescript
// tests/worker/api.test.ts (excerpt)
import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { JWT_HEADER, signDevJwt } from "@adrianhall/cloudflare-auth";
import app from "../../src/index";

async function dispatch(req: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const token = await signDevJwt("test@example.com");
const res = await dispatch(
  new Request("http://localhost/api/videos", {
    headers: { [JWT_HEADER]: token },
  }),
);
expect(res.status).toBe(200);
```

### Coverage scope decision

`src/workflow.ts` and `src/container.ts` are excluded from coverage
thresholds.  Including them would require miniflare to simulate full
Workflow execution and Docker container calls — neither of which is
supported in unit tests.  They belong in the `container` and `integration`
suites (future issues).  Excluding them keeps the 75% threshold achievable
for the code that is actually testable in this issue.

### New root `devDependencies`

| Package | Purpose |
|---------|---------|
| `@vitest/coverage-istanbul` | Istanbul coverage provider (runtime-agnostic) |
| `@testing-library/react` | React component testing utilities |
| `@testing-library/jest-dom` | DOM matchers (`toBeInTheDocument`, etc.) |
| `@testing-library/user-event` | Realistic user interaction simulation |
| `@vitejs/plugin-react` | JSX transform for the `ui` vitest project |
| `jsdom` | DOM environment for UI tests |

`@vitejs/plugin-react` must be in the **root** `devDependencies` (not just
`ui/devDependencies`) because `vitest.config.ts` imports it at the root
level.  Node.js module resolution does not walk down into subdirectory
`node_modules`.

## Manual Tests

1. Run `npm test` — all tests in `worker` and `ui` projects pass; `container`
   and `integration` are skipped (empty include globs)
2. Run `npm run test:coverage` — coverage report generated; text summary
   shows ≥ 75% across lines/functions/branches/statements for included files
3. Run `npx vitest run --project worker` — only worker tests execute
4. Run `npx vitest run --project ui` — only UI tests execute
5. Run `npm run check` — all four checks pass (biome, types, infra, markdown)

## Other Notes

- `wrangler.test.jsonc` is committed but `worker-configuration.d.ts` remains
  gitignored (generated by `pretest` on every `npm test` run).
- The `coverage/` output directory is already in `.gitignore`.  Add
  `!coverage` to `biome.json` `files.includes` to prevent biome from
  scanning the generated HTML reports.
- TypeScript `check:types` (`tsc -b --noEmit`) requires `worker-configuration.d.ts`
  to exist.  Running `npm test` first (which triggers `pretest`) satisfies this.
  CI pipelines should run `npm test` before `npm run check` or run
  `npm run generate:types:test` explicitly.
- The worker project's `tests/worker/tsconfig.json` extends
  `src/tsconfig.json` and adds `@cloudflare/vitest-pool-workers/types` to
  provide the `cloudflare:test` and `cloudflare:workers` module types.
