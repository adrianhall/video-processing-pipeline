# Decisions Log

Records variances from the plan and reasons. Each entry includes the issue where the decision was made.

---

## ISSUE-02: Cloudflare provider v5 API token data source rename

**Decision**: Used `cloudflare_api_token_permission_groups_list` (with URL-encoded `name` parameter) instead of `cloudflare_api_token_permission_groups` as specified in the issue.

**Reason**: The `cloudflare_api_token_permission_groups` data source was removed in the Cloudflare Terraform provider v5. The v5-native replacement is `cloudflare_api_token_permission_groups_list`, which filters by URL-encoded `name` and returns a `result` list. Each permission group is referenced as `result[0].id`.

**Implication**: Future issues referencing permission groups via Terraform must use `cloudflare_api_token_permission_groups_list` with URL-encoded names (spaces → `%20`). The `result[0].id` access pattern is also slightly different from the v4 map-based access (`data.cloudflare_api_token_permission_groups.all.account["Name"]`).

---

## ISSUE-02: cloudflare_api_token `resources` attribute is JSON-encoded string

**Decision**: Used `jsonencode({...})` for the `policies[*].resources` attribute of `cloudflare_api_token` rather than a raw HCL map.

**Reason**: In the Cloudflare provider v5, the `resources` attribute of `cloudflare_api_token` is typed as `string` (a JSON-encoded object), not an HCL map. Using a bare map literal causes a type mismatch error during `terraform validate`. The `jsonencode()` function is the correct way to produce this value.

---

## ISSUE-01/02: check:markdown scope narrowed to docs/**/*.md

**Decision**: The `check:markdown` script was changed from `'**/*.md' '#node_modules'` to `'docs/**/*.md' '#node_modules'` (by the operator, during ISSUE-02 execution).

**Reason**: The broad glob pattern scanned markdown files inside `.opencode/node_modules/` and `infra/.terraform/providers/` (downloaded by `terraform init`), both of which contain third-party README files with markdown violations that are not within the project's control. Scoping to `docs/**` restricts linting to authored documentation only.
