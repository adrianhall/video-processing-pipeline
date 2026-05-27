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
video is uploaded to Cloudflare Stream for playback.

This is example code for a blog article about **Cloudflare Workflows**. The
Workflow implementation must remain simple, linear, and thoroughly documented.

### Technology Stack

| Layer | Technology |
|-------|-----------|
| Infrastructure | Terraform (cloudflare v5 provider) |
| IaC Bridge | `@adrianhall/cloudflare-scripts` (`generate-wrangler`) |
| Auth | Cloudflare Access + `@adrianhall/cloudflare-auth` |
| API | Hono (Workers-native router) |
| Database | Cloudflare D1 (SQLite) |
| Object storage | Cloudflare R2 |
| Orchestration | Cloudflare Workflows |
| Video processing | Cloudflare Containers + ffmpeg (Python/Flask) |
| Video delivery | Cloudflare Stream |
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
│   └── Dockerfile            # Placeholder stub; replaced by ffmpeg issue
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
│   └── index.ts              # Entry point (stub — see implementation issues)
│
└── ui/                       # React SPA (Vite)
    ├── tsconfig.json
    └── src/                  # Components, API client (not yet implemented)
```

---

## Current Implementation Status

### Completed (ISSUE-01 through ISSUE-04)

- Root `package.json` with all orchestration scripts
- Biome config, TypeScript project references
- `infra/` — Terraform resources provisioned (Worker, D1, R2, API tokens)
- `wrangler.jsonc.tpl` — full bindings template
- `migrations/0001_init.sql` — `videos` table schema
- `container/Dockerfile` — placeholder stub (Python health server)
- `src/index.ts` — minimal Worker stub (returns `"OK"`)

### Not Yet Implemented (ISSUE-05+)

- Hono app setup with auth middleware (`src/index.ts`)
- Shared TypeScript types (`src/types.ts`)
- API routes: upload, videos CRUD, workflow status (`src/api/`)
- Presigned URL helper (`src/lib/presigned.ts`)
- ffmpeg container: Dockerfile, Flask server, `FFmpegContainer` class
- `VideoProcessingWorkflow` class (`src/workflow.ts`)
- React UI: components, API client, Vite config
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
- Types for the Worker runtime come from `@cloudflare/workers-types`
- `Env` interface is generated by `wrangler types` — never hand-write it
- Run `wrangler types` after any wrangler.jsonc change to regenerate types

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

---

## Infrastructure Notes

### Provisioned Resources

- **Worker**: `video-pipeline-worker`
- **D1**: `video-pipeline-db` (with `read_replication = { mode = "disabled" }`)
- **R2**: `video-pipeline-bucket`
- **API tokens**: R2 token (R2 Storage Write), Stream token (Stream Write)

### Token Strategy

API tokens for R2 and Stream are created by Terraform and passed as plaintext
`vars` in `wrangler.jsonc`. This is a deliberate demo convenience — a
production system would use `wrangler secret put` or Secrets Store.

### Permission Groups Lookup

Use `cloudflare_account_api_token_permission_groups_list` (account-level), not
`cloudflare_api_token_permission_groups_list` (user-level). The user-level
endpoint returns 403 with scoped API tokens. Permission group names are passed
as **plain text** (not URL-encoded) — the Terraform HTTP client encodes
automatically. See `docs/DECISIONS.md` for full details.

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
list as of ISSUE-04:

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
