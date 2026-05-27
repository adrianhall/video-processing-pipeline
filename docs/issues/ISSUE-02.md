# Issue 02 — Terraform Infrastructure

## Summary

Create the Terraform configuration that provisions the three Cloudflare resources (Worker, D1 database, R2 bucket) using the cloudflare v5 provider and the `jrhouston/dotenv` provider for credentials. Wire up `check:infra` and `fix:infra` scripts.

## Relevant Skills

- `cloudflare-scripts`
- `cloudflare`
- `wrangler`

## Dependencies

- ISSUE-01 (project scaffolding — `package.json` with provision/teardown scripts)

## Acceptance Criteria

- [ ] `infra/terraform.tf` declares required providers: `cloudflare ~> 5.0` and `dotenv ~> 1.0`
- [ ] `infra/main.tf` reads `.env` via the dotenv provider, configures the cloudflare provider, and creates five resources: `cloudflare_worker`, `cloudflare_d1_database` (with `read_replication`), `cloudflare_r2_bucket`, `cloudflare_api_token` (R2), `cloudflare_api_token` (Stream)
- [ ] The R2 API token has Object Read & Write permission scoped to the account — its `id` is the S3 Access Key ID and its `value` is the S3 Secret Access Key
- [ ] The Stream API token has Stream Read and Write permission scoped to the account
- [ ] `infra/outputs.tf` exports scalar string outputs: `account_id`, `worker_name`, `d1_database_id`, `d1_database_name`, `r2_bucket_name`, `team_domain`, `workers_domain`, plus sensitive outputs: `r2_token_id`, `r2_token_value`, `stream_token_value`
- [ ] All three token outputs are marked `sensitive = true`
- [ ] `check:infra` script is added to `package.json`: `terraform -chdir=infra validate`
- [ ] `fix:infra` script is added to `package.json`: `terraform -chdir=infra fmt`
- [ ] `npm run check` passes (including the new `check:infra` — note: requires `npm run preprovision` first)
- [ ] `npm run fix` passes (including the new `fix:infra`)

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `infra/terraform.tf` | Added | Required providers block |
| `infra/main.tf` | Added | Provider config, data sources, five resources (Worker, D1, R2, 2x API Token) |
| `infra/outputs.tf` | Added | Scalar string outputs for generate-wrangler (including 3 sensitive token outputs) |
| `package.json` | Modified | Add `check:infra` and `fix:infra` scripts |

## Technical Implementation

### `infra/terraform.tf`

```hcl
terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    dotenv = {
      source  = "jrhouston/dotenv"
      version = "~> 1.0"
    }
  }
}
```

### `infra/main.tf`

Key rules from the `cloudflare-scripts` skill:

- **Use `cloudflare_worker`** (not `cloudflare_workers_script`) — the v5-native resource. The legacy resource does not reliably clean up on `terraform destroy`.
- **Include `read_replication = { mode = "disabled" }`** in `cloudflare_d1_database` — without this, Terraform detects a diff on every apply.
- Use `data "dotenv" "env" { filename = "../.env" }` to read credentials.
- Resource naming convention: `video-pipeline` prefix (e.g., `video-pipeline-worker`, `video-pipeline-db`, `video-pipeline-bucket`).

### API Token Resources

Create two `cloudflare_api_token` resources. Look up exact permission group IDs via `data "cloudflare_api_token_permission_groups"` or the Cloudflare API docs.

**R2 token** — used as S3-compatible credentials for presigned URLs:

```hcl
resource "cloudflare_api_token" "r2_token" {
  name = "video-pipeline-r2"
  policies = [{
    effect             = "allow"
    permission_groups  = [{ id = "<Workers R2 Storage Write permission group ID>" }]
    resources          = { "com.cloudflare.api.account.${local.account_id}" = "*" }
  }]
}
```

**Stream token** — used for the Stream copy-from-URL API:

```hcl
resource "cloudflare_api_token" "stream_token" {
  name = "video-pipeline-stream"
  policies = [{
    effect             = "allow"
    permission_groups  = [{ id = "<Stream Write permission group ID>" }]
    resources          = { "com.cloudflare.api.account.${local.account_id}" = "*" }
  }]
}
```

The `.env` deployment token must have the **API Tokens: Edit** permission to create child tokens.

### `infra/outputs.tf`

All outputs must be `string` type (no lists, maps, or objects). `generate-wrangler` will fail with exit code 7 on complex types. The output names become `{{placeholder}}` identifiers in `wrangler.jsonc.tpl`.

Token outputs must be marked `sensitive = true`:

```hcl
output "r2_token_id" {
  value     = cloudflare_api_token.r2_token.id
  sensitive = true
}

output "r2_token_value" {
  value     = cloudflare_api_token.r2_token.value
  sensitive = true
}

output "stream_token_value" {
  value     = cloudflare_api_token.stream_token.value
  sensitive = true
}
```

`generate-wrangler` reads from `terraform output -json`, which includes sensitive values. The resulting `wrangler.jsonc` is gitignored and contains these tokens as plaintext vars. This is a deliberate demo convenience — a production system should use `wrangler secret put`.

### npm Scripts

Add to the `scripts` block:

```json
"check:infra": "terraform -chdir=infra validate",
"fix:infra": "terraform -chdir=infra fmt"
```

Note: `check:infra` requires providers to be initialized. If it fails with "providers not initialized", the user must run `npm run preprovision` first. The `preprovision` script (already in package.json from ISSUE-01) runs `terraform -chdir=infra init` which is idempotent.

## Manual Tests

1. Run `npm run preprovision` — terraform init succeeds, downloads providers
2. Run `npm run check` — all checks pass including `check:infra`
3. Inspect `infra/main.tf` — uses `cloudflare_worker` (not `cloudflare_workers_script`), D1 has `read_replication` block, two `cloudflare_api_token` resources exist

## Other Notes

Do **not** run `npm run provision` in this issue — that requires real Cloudflare credentials in `.env`. The `.env` deployment token must have **API Tokens: Edit** permission to create child tokens. The acceptance criteria only require that `terraform validate` passes.

The exact `permission_groups` IDs for R2 and Stream may need to be looked up at implementation time. Use `data "cloudflare_api_token_permission_groups"` or retrieve them from the Cloudflare API documentation.
