# AGENTS.md — Video Processing Pipeline

Authoritative guide for AI agents working in this repository. Read this file
before reading any source code or running any commands.

---

## CRITICAL: Documentation-First Policy

**Always reach for documentation before inspecting `node_modules`, running
scripts, or reading package source files.**

| Information need | Correct tool | Requires approval? |
|------------------|--------------|--------------------|
| Cloudflare API shapes, limits, config fields | `cloudflare-docs` MCP search tool or `WebFetch` to `developers.cloudflare.com` | No |
| Wrangler CLI flags, config schema | `WebFetch` to `developers.cloudflare.com/workers/wrangler/` or `node_modules/wrangler/config-schema.json` (read-only) | No |
| npm package API / types | `WebFetch` to package docs, or read `.d.ts` files in `node_modules` (read-only) | No |
| Running a Node.js or Python script | Bash tool | **Yes — human approval required** |
| Running `terraform` commands | Bash tool | **Yes — human approval required** |
| Running `wrangler` commands | Bash tool | **Yes — human approval required** |

Every shell command that executes a script — `node`, `python`, `tsx`,
`wrangler`, `terraform apply`, or any npm `run` script that in turn invokes one
of those — must be approved by the human operator before it is run. Reading
documentation via `WebFetch` or the `cloudflare-docs` MCP search tool is always
free and does not require approval.

The practical consequence: **prefer `WebFetch` over `npm exec` or
`node -e "require(...)"` when the goal is to understand an API**. If you are
unsure how a Cloudflare binding works, fetch the docs. Do not `require` or
`import` the package to inspect it.

---

## Project Overview

A video-processing pipeline built on the Cloudflare developer platform. Users
upload videos via a drag-and-drop web interface. A Cloudflare Workflow
orchestrates multi-step processing (format detection, transcoding, audio
extraction, grayscale conversion) using an ffmpeg Container. The final grayscale
MP4 is stored in R2 and served for browser playback via an authenticated Worker
streaming endpoint.

This is example code for a blog article about **Cloudflare Workflows**. The
Workflow implementation must remain simple, linear, and thoroughly documented.

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Infrastructure | Terraform (cloudflare v5 provider) |
| IaC Bridge | `@adrianhall/cloudflare-scripts` (`generate-wrangler`, `generate-types`) |
| Auth | Cloudflare Access + `@adrianhall/cloudflare-auth` |
| API | Hono (Workers-native router) |
| Database | Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 |
| Orchestration | Cloudflare Workflows |
| Video processing | Cloudflare Containers + ffmpeg (Python/Flask) |
| Video delivery | R2 via Worker streaming endpoint (`GET /api/videos/:id/stream`) |
| Frontend | React 18 + Vite + Tailwind CSS v4 + shadcn/ui |
| Linting/Formatting | Biome (replaces ESLint + Prettier) |
| Script composition | npm-run-all2 (`run-s`) |
| Testing | Vitest + `@cloudflare/vitest-pool-workers` |

---

## Repository Structure

```text
video-processing-pipeline/
├── .env                      # Cloudflare credentials (gitignored)
├── .env.example              # Credential template (committed)
├── biome.json                # Shared lint + format config
├── package.json              # Root package — all orchestration scripts
├── tsconfig.json             # Project-references root (src/ + ui/)
├── wrangler.jsonc.tpl        # Wrangler config template (committed)
├── wrangler.jsonc            # Generated config (gitignored)
│
├── container/
│   ├── Dockerfile            # ffmpeg + gunicorn container image
│   ├── server.py             # Flask HTTP wrapper (POST /transcode, /extract-audio, /grayscale)
│   └── requirements.txt      # Python dependencies
│
├── docs/
│   ├── PLAN.md               # Full architecture and design decisions
│   ├── DECISIONS.md          # Variance log (read before implementing)
│   ├── SKILLS.md             # Skills to load for every issue
│   ├── EXAMPLE-ISSUE.md      # Template for new issue documents
│   └── issues/
│       └── ISSUE-XX.md       # One file per issue
│
├── infra/
│   ├── terraform.tf          # Required providers (cloudflare v5, dotenv)
│   ├── main.tf               # Resources: Worker, D1, R2, API tokens
│   └── outputs.tf            # All string outputs for generate-wrangler
│
├── migrations/
│   └── 0001_init.sql         # D1 schema: videos table + status index
│
├── src/                      # Worker TypeScript (Hono API + Workflow + Container)
│   ├── tsconfig.json         # composite: true, Workers types
│   ├── index.ts              # Entry point — Hono app + auth middleware
│   ├── types.ts              # Shared types (VideoStatus, VideoResource, etc.)
│   ├── workflow.ts           # VideoProcessingWorkflow (5 steps)
│   ├── container.ts          # FFmpegContainer Durable Object
│   ├── api/
│   │   └── videos.ts         # ALL /api/videos routes in one file (see routing note)
│   └── lib/
│       └── presigned.ts      # R2 S3 presigned URL helper
│
└── ui/                       # React SPA (Vite — implemented ISSUE-19 onwards)
    ├── tsconfig.json
    └── src/                  # Components, API client
```

---

## Current Implementation Status

### Completed (ISSUE-01 through ISSUE-20)

The full backend pipeline and initial frontend upload flow are implemented.

- Root `package.json`, Biome, TypeScript project references
- `infra/` — Worker, D1, R2, R2 API token (Terraform v5)
- `wrangler.jsonc.tpl` — full bindings template
- `migrations/0001_init.sql` — `videos` table schema
- `container/` — full ffmpeg + Flask server (`/transcode`, `/extract-audio`, `/grayscale`)
- `src/index.ts` — Hono app + Cloudflare Access auth middleware
- `src/types.ts` — `VideoStatus`, `VideoResource`, `VideoWorkflowParams`, etc.
- `src/lib/presigned.ts` — R2 S3 presigned URL helper
- `src/api/videos.ts` — ALL `/api/videos` routes (upload, CRUD, stream, status)
- `src/workflow.ts` — `VideoProcessingWorkflow` (5 steps: register, transcode, extract-audio, grayscale, finalize)
- `src/container.ts` — `FFmpegContainer` with lifecycle hooks and health-check fetch override
- `scripts/pipeline-smoke-test.sh` — full end-to-end smoke test
- `ui/` — React + Vite + Tailwind v4 + shadcn/ui (nova preset) project setup (ISSUE-19)
- `ui/src/api.ts` — `createVideo()`, `startProcessing()`, `fetchVideos()` API client functions; `VideoStatus` and `VideoResource` types (ISSUE-20, ISSUE-21)
- `ui/src/components/UploadZone.tsx` — drag-and-drop upload zone with XHR progress tracking (ISSUE-20)
- `ui/src/components/VideoCard.tsx` — individual video status card with status badge mapping (ISSUE-21)
- `ui/src/components/VideoList.tsx` — video dashboard grid with skeleton loading (ISSUE-21)
- `ui/src/components/VideoPlayer.tsx` — HTML5 `<video>` in a shadcn Dialog; lazy-loaded via `React.lazy()`; `App.tsx` state changed from `selectedVideoId: string` to `selectedVideo: VideoResource | null` (ISSUE-22)

### Not Yet Implemented (ISSUE-23+)

- Vitest config and test suite

---

## npm Scripts Reference

| Script | Purpose |
|--------|---------|
| `npm run check` | **Run all quality checks** (biome → types → infra → markdown). Fail-fast via `run-s`. |
| `npm run fix` | Auto-fix all fixable issues (biome format/lint, terraform fmt) |
| `npm run build` | Build all sub-projects (currently a stub for UI) |
| `npm test` | Run Vitest (Workers runtime — requires `wrangler.jsonc`) |
| `npm run provision` | `terraform init` + `apply` + `generate-wrangler` |
| `npm run deploy` | Build UI + migrate remote D1 + `wrangler deploy` |
| `npm start` | Build UI + migrate local D1 + `wrangler dev` |
| `npm run db:migrate:local` | Apply pending D1 migrations to local simulation |
| `npm run db:migrate:remote` | Apply pending D1 migrations to remote D1 |
| `npm run teardown` | `terraform destroy` + remove `wrangler.jsonc` |

**Always run `npm run fix && npm run check` before committing.** All four
checks (biome, types, infra, markdown) must pass with zero errors.

---

## Quality Rules

### TypeScript

- Strict mode — no `any`, no non-null assertions without justification
- `moduleResolution: "Bundler"` — use `import type` for type-only imports
- Worker runtime types are bundled into `worker-configuration.d.ts` by `wrangler types --include-runtime`; do **not** add `@cloudflare/workers-types` as a dependency
- `Env` interface is generated by `wrangler types` via `npm run generate:types` — never hand-write it
- Run `npm run generate:types` after any `wrangler.jsonc` change to regenerate types

### Biome

- 2-space indent, double quotes (`"`)
- Biome replaces both ESLint and Prettier — do not install either
- `container/` and `infra/` are excluded from Biome (see `biome.json`)
- `fix:biome` (`biome check --write .`) applies all safe fixes automatically

### Terraform

- Provider: `cloudflare ~> 5.0` and `dotenv ~> 1.0`
- All resources use v5 resource names (e.g. `cloudflare_worker`, not `cloudflare_workers_script`)
- All outputs must be `string` or `number` — `generate-wrangler` does not support complex types
- Run `terraform -chdir=infra fmt` before committing infra changes

### JSDoc (mandatory for TypeScript)

Every exported `function`, `class`, `interface`, `type`, and `enum` must have a
JSDoc block with: prose description, `@param` per parameter, `@returns` for
non-void functions, and `@example` where the usage is non-obvious. React
components additionally need a `@param props` entry and a JSX `@example`.

---

## Key Architecture Constraints

These are non-negotiable; deviating produces bugs that are hard to diagnose.

### Authentication (`@adrianhall/cloudflare-auth`)

1. `developerAuthentication` **must be registered before** `cloudflareAccess`
2. `run_worker_first: true` is **required** in `wrangler.jsonc` assets config —
   all requests (including initial page load) must traverse the auth middleware
   before the SPA makes API calls
3. Do not add `/_auth/*` to `PathPolicy[]` — `developerAuthentication` owns
   those paths internally
4. Use `signDevJwt()` from `@adrianhall/cloudflare-auth` in tests — not raw JWTs

### Wrangler Config (`wrangler.jsonc.tpl`)

- Template placeholders use `{{name}}` syntax; `generate-wrangler` substitutes
  from `terraform output -json`
- `wrangler.jsonc` is gitignored and regenerated by `postprovision`
- Containers require **three** config blocks: `containers` (image),
  `durable_objects.bindings` (env name), and `migrations` (DO registration)
- `nodejs_compat` flag is required for `@aws-sdk` presigned URL helpers

### Hono Static Assets

Use `c.env.ASSETS.fetch(c.req.raw)` as the catch-all, **not** `serveStatic`
from `hono/cloudflare-workers`. `serveStatic` reads `__STATIC_CONTENT` (legacy
Workers Sites), which is undefined with the assets binding and will 404.

### API Response Shape

All API responses must use the standard envelope:

- Success: `{ data: T }`
- Error: `{ error: string; detail?: string }`

### D1 Timestamps

D1 is SQLite — there is no native `DATETIME` type. All timestamps are `TEXT`
in ISO 8601 format (`datetime('now')` default in SQL; `new Date().toISOString()`
in TypeScript).

### Upload Flow

Files are uploaded **directly from the browser to R2** via presigned PUT URLs.
The Worker never proxies the file body (Workers has a 100 MB body limit).

### Hono Route Ordering

**All `/api/videos` routes live in a single file** (`src/api/videos.ts`).
Do not split them across multiple routers mounted at the same prefix — Hono
v4 uses first-match routing and a `GET /:id` registered in one sub-router
will shadow `GET /:id/stream` in a later sub-router before it is evaluated.

Within the file, routes with literal suffixes **must** be registered before
the bare parameter catch:

```typescript
// CORRECT — most specific first
videosRouter.get("/:id/status", ...);  // registered before /:id
videosRouter.get("/:id/stream", ...);  // registered before /:id
videosRouter.get("/:id", ...);         // bare catch — LAST
```

Reversing this order causes `GET /api/videos/{id}/stream` to match `/:id`
with `id = "{uuid}/stream"`, which Hono resolves as a 404.

### wrangler dev R2 Storage Split

In `wrangler dev` (local mode, the default for `npm start`), R2 bindings and
presigned-URL `fetch()` calls use **separate storage backends**:

| Access method | Backend |
|---|---|
| `BUCKET.get()` / `BUCKET.put()` Worker binding | Local simulation (`.wrangler/state/v3/r2/`) |
| `fetch()` with presigned R2 URL from Worker code | Real Cloudflare R2 |
| ffmpeg container presigned PUT/GET | Real Cloudflare R2 (via Docker networking) |

**Rule**: Any file written to real R2 by the ffmpeg container (e.g.
`bwvideo/{id}.mp4`) must be read back with `fetch(presignedGetUrl)`, not
`BUCKET.get()`. The binding will always return `null` for container-written
files in local dev. See `src/api/videos.ts` `GET /:id/stream` for the
reference implementation.

The same split applies to D1: data written by the Worker in local mode lives
in `.wrangler/state/v3/d1/`, not the remote Cloudflare D1. When running the
smoke test against a local dev server, use `D1_LOCAL=1` (the script
auto-detects this when `BASE` contains `localhost`).

### R2 S3 Credentials

The R2 S3-compatible API requires credentials in a specific format (see
`docs/DECISIONS.md` ISSUE-18 for full details):

- **Access Key ID** — `cloudflare_account_token.id` (the token UUID as-is)
- **Secret Access Key** — **`sha256(cloudflare_account_token.value)`** — the
  64-character hex SHA-256 digest of the raw `cfat_…` value, NOT the raw
  value itself

Using the raw `cfat_…` value as the secret produces wrong HMAC signatures
and every presigned URL returns HTTP 403. In `infra/outputs.tf`:
`value = sha256(cloudflare_account_token.r2_token.value)`.

### wrangler dev Container HTTPS Proxy

When `wrangler dev` starts, a `cloudflare/proxy-everything` sidecar container
intercepts **all outbound TCP** from Docker containers (including HTTPS) and
routes it through wrangler's local simulation using a self-signed TLS
certificate. Python's `urllib` rejects this by default.

The fix in `container/server.py`: `_UNVERIFIED_SSL_CTX = ssl.create_default_context()` with `CERT_NONE`, passed to every `urllib.request.urlopen()` call. This is safe for R2 presigned URLs because their security comes from HMAC signatures, not TLS certificate chains.

This does **not** affect the Worker's own `fetch()` calls — the Worker runs
in wrangler's Node.js process, not in Docker, so it reaches real HTTPS
endpoints directly.

---

## Infrastructure Notes

### Provisioned Resources

- **Worker**: `video-pipeline-worker`
- **D1**: `video-pipeline-db` (with `read_replication = { mode = "disabled" }`)
- **R2**: `video-pipeline-bucket`
- **API tokens**: R2 token only (R2 Storage Write) — Stream token removed

### Token Strategy

The R2 API token is created by Terraform and passed as plaintext `vars` in
`wrangler.jsonc`. This is a deliberate demo convenience — a production system
would use `wrangler secret put` or Secrets Store.

The R2 token provides two values:

- `R2_ACCESS_KEY_ID` = `r2_token.id` (token UUID)
- `R2_SECRET_ACCESS_KEY` = `sha256(r2_token.value)` ← SHA-256 hash, not raw value

### Permission Groups Lookup

Use `cloudflare_account_api_token_permission_groups_list` (account-level), not
`cloudflare_api_token_permission_groups_list` (user-level). The user-level
endpoint returns 403 with scoped API tokens. Permission group names are passed
as **plain text** (not URL-encoded) — the Terraform HTTP client encodes
automatically. See `docs/DECISIONS.md` for full details.

## Generated files

Generated files **MUST** be listed in `.gitignore`. Never commit them.

| File | Location | Generated by |
|------|----------|--------------|
| `wrangler.jsonc` | project root | `postprovision` (`generate-wrangler` from Terraform outputs) |
| `worker-configuration.d.ts` | project root | `generate:types` (`wrangler types --include-runtime`) |
| `public/*` | project root | `build:ui` (Vite — ISSUE-19 onwards) |

Both `wrangler.jsonc` and `worker-configuration.d.ts` contain environment-specific values
(infrastructure IDs, API token values as type literals) that differ per developer and must
not enter version control. If you create a new generated file, add it to `.gitignore`
before committing anything.

---

## Decisions Log

`docs/DECISIONS.md` records every variance from `docs/PLAN.md`. **Read it
before implementing any issue.** Key entries:

- **ISSUE-02**: Must use `cloudflare_account_token` and account-level permission
  group lookups; `resources` attribute uses `jsonencode({})`
- **ISSUE-03**: `containers` entry has no `binding` field; binding lives in
  `durable_objects.bindings`; `migrations.new_sqlite_classes` is required
- **ISSUE-04**: `container/Dockerfile` is a placeholder stub added early to
  unblock `wrangler` config validation; it will be replaced
- **ISSUE-18**: R2 Secret Access Key must be `sha256(token.value)` — raw `cfat_…` value produces 403
- **ISSUE-18**: Cloudflare Stream replaced by direct R2 playback — `GET /api/videos/:id/stream`
- **ISSUE-18**: wrangler dev local R2 binding and real R2 are separate stores
- **ISSUE-18**: wrangler dev intercepts container HTTPS via `cloudflare/proxy-everything` self-signed proxy

---

## Issue Execution Workflow

Issues are executed via `.opencode/commands/run-issue.md`. The workflow:

1. Verify current branch is `main`
2. Read the issue file from `docs/issues/ISSUE-XX.md`
3. Create branch `issues/XX`
4. Load skills from `docs/SKILLS.md` (always) + issue's `## Relevant Skills`
5. Plan tasks with `TodoWrite` before writing code
6. Implement — match paths in issue and `PLAN.md` exactly
7. Add JSDoc to every exported symbol
8. Run `npm run fix && npm run check && npm run build`
9. Run `npm test` if worker API code was modified
10. Update `docs/PLAN.md` / `docs/DECISIONS.md` / add follow-up issues as needed
11. Commit: `<type>(issue-XX): <description>`
12. Report: branch, hash, summary, deviations, follow-ups, smoke tests

### Commit Convention

```text
<type>(issue-XX): <imperative description ≤72 chars>

- bullet list of what was implemented
```

Types: `feat` (new functionality), `fix`, `chore` (scaffolding/config),
`test`, `docs`, `refactor`.

---

## Skills

Load the skills in `docs/SKILLS.md` at the start of every issue. The full
list as of ISSUE-18:

`cloudflare`, `cloudflare-auth`, `cloudflare-scripts`, `durable-objects`,
`react-modernization`, `react-state-management`, `shadcn`,
`tailwind-design-system`, `typescript-advanced-types`,
`vercel-composition-patterns`, `vercel-react-best-practices`,
`vercel-react-view-transitions`, `web-component-design`,
`web-design-guidelines`, `web-perf`, `webapp-testing`,
`workers-best-practices`, `wrangler`

Each issue may list additional skills in its `## Relevant Skills` section.

---

## Smoke-Test Checklist (Current State)

After any change, verify:

1. `npm run check` — all four checks green (biome, types, infra, markdown)
2. `npm run build` — no errors or significant warnings
3. If `wrangler.jsonc` exists: `npm run db:migrate:local` — migration applied
4. If `wrangler.jsonc` exists: `wrangler dev` starts without config errors

### Full Pipeline Smoke Test

Run after `npm start` is running against real bindings
(`wrangler.jsonc` must exist — run `npm run provision` first):

```bash
bash scripts/pipeline-smoke-test.sh demo-videos/test-3.webm
```

The script auto-detects local vs remote D1 from the `BASE` URL.
All 9 numbered checks must print `PASS` and the final line must be
`All pipeline smoke tests passed.`

Three demo videos exercise different code paths:

- `test-3.webm` — WebM → full container pipeline (fastest, 2.3 MB)
- `test-1.mp4` — MP4 fast-path bypass (no container transcoding)
- `test-2.avi` — AVI → full container pipeline (stress-tests under load)
