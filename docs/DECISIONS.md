# Decisions Log

Records variances from the plan and reasons. Each entry includes the issue where the decision was made.

---

## ISSUE-02: Account-level tokens and permission group lookups required

**Decision**: Used `cloudflare_account_token` (not `cloudflare_api_token`) and `cloudflare_account_api_token_permission_groups_list` (not `cloudflare_api_token_permission_groups`) for all token creation and permission lookups.

**Reason**: Three separate issues were discovered when attempting `npm run provision` with the user-level variants:

1. **`cloudflare_api_token_permission_groups` removed in v5** — the data source no longer exists; the v5 replacement is either `cloudflare_api_token_permission_groups_list` (user-level) or `cloudflare_account_api_token_permission_groups_list` (account-level).

2. **User-level endpoint 403** — `cloudflare_api_token_permission_groups_list` calls `/v4/user/tokens/permission_groups`, which requires a Global API Key or a user-level token with "API Tokens" permission. A scoped account API token (the typical `.env` deployment credential) cannot authenticate to this endpoint and returns `403 "Valid user-level authentication not found"`. The account-level data source calls `/v4/accounts/{id}/tokens/permission_groups` instead, which works with account-scoped tokens.

3. **Double URL-encoding** — the `name` parameter must be passed as plain text (`Workers R2 Storage Write`). The Terraform HTTP client URL-encodes query parameters automatically. Passing pre-encoded values (e.g. `Workers%20R2%20Storage%20Write`) results in double-encoding (`%2520`) which causes the filter to return no results.

**Implication**: The deployment API token in `.env` must have `Account API Tokens Write` permission (to create `cloudflare_account_token` resources) rather than user-level `API Tokens Write`. Permission group names in `cloudflare_account_api_token_permission_groups_list` must be plain text, not URL-encoded. `result[0].id` is used to reference the looked-up permission group ID.

---

## ISSUE-02: cloudflare_api_token `resources` attribute is JSON-encoded string

**Decision**: Used `jsonencode({...})` for the `policies[*].resources` attribute of `cloudflare_api_token` rather than a raw HCL map.

**Reason**: In the Cloudflare provider v5, the `resources` attribute of `cloudflare_api_token` is typed as `string` (a JSON-encoded object), not an HCL map. Using a bare map literal causes a type mismatch error during `terraform validate`. The `jsonencode()` function is the correct way to produce this value.

---

## ISSUE-03: Containers config requires durable_objects.bindings and migrations; no binding field

**Decision**: The `containers` array entry uses only `class_name` and `image`. The binding name (`FFMPEG_CONTAINER`) lives in `durable_objects.bindings`, and a `migrations` block with `new_sqlite_classes` is required to register the DO class.

**Reason**: Three errors were present in the PLAN.md template:

1. **`"binding"` is not a valid field in a `containers` entry** — the `ContainerApp` JSON schema has `additionalProperties: false`. The field is silently flagged as an error by the VSCode schema checker. The binding name belongs in `durable_objects.bindings[].name`, not in the container item itself.

2. **`"image"` must point to the Dockerfile, not the directory** — changed from `"./container"` to `"./container/Dockerfile"`. (Note: the Cloudflare docs state that `image` can be a path to a Dockerfile *or* a directory containing one, so the directory form would also work; the explicit Dockerfile path is unambiguous.)

3. **Missing `durable_objects.bindings` and `migrations`** — without `durable_objects.bindings`, `env.FFMPEG_CONTAINER` is undefined in the Worker at runtime. Without `migrations` (specifically `new_sqlite_classes: ["FFmpegContainer"]`), Wrangler rejects the deploy because the Durable Object class is never registered. Both blocks are mandatory for every Container-backed DO per Cloudflare documentation.

**Implication**: Every future issue that references the wrangler template (ISSUE-13 container code, ISSUE-14 workflow code) must use this corrected three-part structure: `containers` (image config) + `durable_objects.bindings` (env binding) + `migrations` (DO registration).

---

## ISSUE-01/02: check:markdown scope narrowed to docs/**/*.md

**Decision**: The `check:markdown` script was changed from `'**/*.md' '#node_modules'` to `'docs/**/*.md' '#node_modules'` (by the operator, during ISSUE-02 execution).

**Reason**: The broad glob pattern scanned markdown files inside `.opencode/node_modules/` and `infra/.terraform/providers/` (downloaded by `terraform init`), both of which contain third-party README files with markdown violations that are not within the project's control. Scoping to `docs/**` restricts linting to authored documentation only.
