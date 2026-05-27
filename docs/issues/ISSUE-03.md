# Issue 03 — Wrangler Template and npm Scripts

## Summary

Create the `wrangler.jsonc.tpl` template file with all bindings (D1, R2, Workflows, Containers, Assets) and placeholder markers that `generate-wrangler` will substitute with Terraform outputs. Wire the `postprovision` script so that `npm run provision` produces a working `wrangler.jsonc`. Also create a local-dev-only `wrangler.jsonc` for use before provisioning.

## Relevant Skills

- `cloudflare-scripts`
- `cloudflare`
- `wrangler`
- `workers-best-practices`

## Dependencies

- ISSUE-01 (project scaffolding)
- ISSUE-02 (Terraform outputs that define the `{{placeholder}}` names)

## Acceptance Criteria

- [ ] `wrangler.jsonc.tpl` exists at the project root with all bindings from the Wrangler Template Design section of PLAN.md
- [ ] Template uses `{{account_id}}`, `{{worker_name}}`, `{{d1_database_id}}`, `{{d1_database_name}}`, `{{r2_bucket_name}}`, `{{team_domain}}`, `{{r2_token_id}}`, `{{r2_token_value}}`, `{{stream_token_value}}` — matching ISSUE-02 output names exactly
- [ ] Template `vars` block includes all five vars: `CLOUDFLARE_TEAM_DOMAIN`, `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_API_TOKEN`
- [ ] Template includes: `compatibility_flags: ["nodejs_compat"]`, `observability` block, `assets` block with `run_worker_first: true` and `binding: "ASSETS"`, `d1_databases`, `r2_buckets`, `workflows`, `containers`
- [ ] No `wrangler secret put` steps are needed — all tokens flow through Terraform → generate-wrangler → vars
- [ ] `db:migrate:remote` script is updated to: `wrangler d1 migrations apply video-pipeline-db`
- [ ] `db:migrate:local` script is updated to: `wrangler d1 migrations apply video-pipeline-db --local`
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `wrangler.jsonc.tpl` | Added | Template with all bindings and `{{placeholder}}` markers |
| `package.json` | Modified | Update `db:migrate:remote` and `db:migrate:local` scripts from stubs to real commands |

## Technical Implementation

### `wrangler.jsonc.tpl`

Use the exact template from PLAN.md's "Wrangler Template Design" section. Critical points:

- **No whitespace inside markers**: `{{account_id}}` not `{{ account_id }}` — the regex is strict.
- **`run_worker_first: true`** in assets block — required for `cloudflare-auth`.
- **`binding: "ASSETS"`** in assets block — required for the catch-all static asset route.
- **`not_found_handling: "single-page-application"`** — required for client-side routing.
- **`nodejs_compat`** flag — required for presigned URL generation.
- **Workflow binding**: `class_name: "VideoProcessingWorkflow"` must match the class exported from `src/workflow.ts` (ISSUE-14).
- **Container binding**: `class_name: "FFmpegContainer"` must match the class exported from `src/container.ts` (ISSUE-13).

### npm Script Updates

Replace the echo stubs:

```json
"db:migrate:remote": "wrangler d1 migrations apply video-pipeline-db",
"db:migrate:local": "wrangler d1 migrations apply video-pipeline-db --local"
```

These will fail gracefully until ISSUE-04 creates the migrations directory and SQL file. The `--local` flag is for local development; the remote variant is used in `predeploy`.

## Manual Tests

1. Open `wrangler.jsonc.tpl` and verify all `{{placeholder}}` names match the output names in `infra/outputs.tf`
2. Run `npm run check` — passes with zero errors

## Other Notes

The generated `wrangler.jsonc` is gitignored (already configured in ISSUE-01). Until `npm run provision` is run with real credentials, local development will require manually creating a minimal `wrangler.jsonc` for `wrangler dev`. This is handled by ISSUE-05's `prestart` chain.

API tokens (R2 S3 credentials, Stream token) are passed as plaintext vars via `generate-wrangler`, not as secrets. This is a deliberate demo convenience — the generated `wrangler.jsonc` is gitignored so the tokens never enter version control. A production system should use `wrangler secret put` or Secrets Store instead.
