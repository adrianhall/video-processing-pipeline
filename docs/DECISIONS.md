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

## ISSUE-04: Placeholder container/Dockerfile added to unblock local development

**Decision**: Added a minimal stub `container/Dockerfile` (Python stdlib HTTP server on port 8080) ahead of the full ffmpeg container implementation issue.

**Reason**: Wrangler validates that the path referenced by `"image": "./container/Dockerfile"` in `wrangler.jsonc` points to a real file when parsing config. Without the file, every `wrangler` command — including `wrangler d1 migrations apply --local` — fails with:

> "The image "./container/Dockerfile" does not appear to be a valid path to a Dockerfile"

The stub is intentionally minimal: it builds without ffmpeg and serves only `GET /health → 200`. It will be replaced entirely by the full Flask + ffmpeg implementation in the container issue.

**Implication**: The container implementation issue should overwrite `container/Dockerfile` (and add `container/server.py` and `container/requirements.txt`) without needing to account for this stub.

---

## ISSUE-06: Switch to `wrangler types --include-runtime` (drop `@cloudflare/workers-types`)

**Decision**: Removed `@cloudflare/workers-types` from `devDependencies`, removed
`"types": ["@cloudflare/workers-types"]` from `src/tsconfig.json`, dropped
`--include-runtime=false` from the `generate-types.js` script, added `@types/node`
(required when `nodejs_compat` is enabled, per Wrangler's own recommendation), and
excluded the generated `src/worker-configuration.d.ts` from Biome's scope.

**Reason**: The original setup used `--include-runtime=false` to keep the committed
`worker-configuration.d.ts` small. The trade-off is an extra devDependency
(`@cloudflare/workers-types`) whose version has to be kept in sync with Wrangler
manually. The Cloudflare-recommended and workers-best-practices canonical approach
is to let `wrangler types` (with the default `--include-runtime=true`) produce a
self-contained file. This also improves binding types: with `--include-runtime`,
Wrangler generates proper generics (`DurableObjectNamespace<FFmpegContainer>` and
`Workflow<VideoWorkflowParams>`) rather than bare unparameterised types.

**Side-effects**:

- `src/worker-configuration.d.ts` grew from 46 lines to ~13,700 lines. The file
  is still committed because `wrangler.jsonc` (needed to regenerate it) is
  gitignored; without a committed copy, TypeScript would fail in a freshly cloned
  repo before provisioning.
- The generated file contains `any` in Cloudflare's own runtime declarations.
  `src/worker-configuration.d.ts` is now excluded from Biome's `includes` in
  `biome.json`; previously it was covered but the 46-line file had no violations.

---

## ISSUE-06: `FFmpegContainer` and `VideoProcessingWorkflow` must be exported from the entry point

**Decision**: Created stub files `src/container.ts` (`FFmpegContainer extends Container`)
and `src/workflow.ts` (`VideoProcessingWorkflow extends WorkflowEntrypoint`),
and re-exported both from `src/index.ts`.

**Reason**: Wrangler validates that every class referenced in `containers`,
`durable_objects.bindings`, and `workflows` config sections is exported from the
Worker entry point (`src/index.ts`). Without those exports, `wrangler dev` (and
`wrangler deploy`) fail with:

> "Your Worker depends on the following Durable Objects, which are not exported
> in your entrypoint file: FFmpegContainer."

The full implementations are deferred to later issues. The stubs are the
minimum needed: `FFmpegContainer extends Container` with `defaultPort = 8080`,
and `VideoProcessingWorkflow extends WorkflowEntrypoint` with a `run()` that
throws `"not yet implemented"`.

**Additional finding**: The `Container` base class is not part of
`@cloudflare/workers-types` — it lives in the separate `@cloudflare/containers`
npm package. This package was added as a production dependency.

**Implication**: The container implementation issue must replace the stub
`src/container.ts` (set `sleepAfter`, add the `fetch` handler and health-check
logic). The workflow implementation issue must replace `src/workflow.ts` with
the full six-step pipeline. Both files already have JSDoc noting they are stubs.

---

## ISSUE-06: `assets` block requires a `directory` property

**Decision**: Added `"directory": "./public"` to the `assets` block in both
`wrangler.jsonc.tpl` and the generated `wrangler.jsonc`.

**Reason**: Wrangler validates that the `assets` configuration block contains a
`directory` field and rejects startup with:

> "The `assets` property in your configuration is missing the required `directory` property."

The original template (written in ISSUE-03/05) included `binding`,
`not_found_handling`, and `run_worker_first` but omitted the required `directory`
key. The `directory` value must be a path relative to the config file — `"./public"`
points at the placeholder `public/index.html` committed in ISSUE-06, and will
continue to point at the Vite build output in ISSUE-19.

**Implication**: All future issues that regenerate `wrangler.jsonc` via
`npm run provision` will get the correct `directory` field from the updated
template.

---

## ISSUE-06: Use `public/*` not `public/` in .gitignore to allow placeholder

**Decision**: Changed the `.gitignore` pattern from `public/` to `public/*` and
added `!public/index.html` to commit the placeholder HTML file.

**Reason**: Git does not traverse into directories that are matched by a
directory-level ignore rule (`public/`). A negation entry (`!public/index.html`)
after an ignored directory has no effect because git stops at the directory
boundary. Switching to a glob pattern (`public/*`) ignores the directory's
*contents* while leaving the directory itself traversable, which allows the
`!public/index.html` negation to take effect.

**Implication**: In ISSUE-19, when Vite is configured to build into `public/`,
the `.gitignore` will need to be updated to re-ignore the generated output files
while retaining the ability to commit any committed placeholder files.

---

## Cloudflare Access: separated policy + application (v5 non-embedded pattern)

**Decision**: Added a standalone `cloudflare_zero_trust_access_policy` resource and a
`cloudflare_zero_trust_access_application` resource. The policy is referenced from the
application via the `policies` list (by `id` + `precedence`). The application's inline
`policies` block (embedded directly inside `cloudflare_zero_trust_access_application`)
was deliberately not used.

**Reason**: The Terraform v5 provider documentation and Cloudflare changelog explicitly
mark the embedded policy approach as deprecated. The separated pattern creates a reusable
account-level policy resource that can be attached to multiple applications and managed
independently. Additionally, the v5.5.0 changelog lists
`cloudflare_zero_trust_access_application` as having had recurring-diff fixes, and the
embedded block was one of the affected patterns.

**Policy rule**: The `include` block uses `login_method` (IdP authentication) rather
than `email_domain` so the demo works for anyone who configures their own IdP. Production
deployments should add a more restrictive rule (e.g., `email_domain` or a group).

**`access_aud` output**: The Access application's audience tag is exported as a sensitive
Terraform output (`access_aud`). It is not injected into `wrangler.jsonc` because
`cloudflare-auth` validates JWTs against the team domain's JWKS endpoint without
requiring the AUD to be a Worker var. The output is available for manual JWT debugging
or future additional validation layers.

**Required API token permission**: `Access: Apps and Policies Write` (under
Cloudflare One / Zero Trust → Access in the dashboard) must be added to the deployment
API token in `.env`. This permission is documented in `.env.example`.

---

## Switch from local `generate-types.js` to `generate-types` CLI (cloudflare-scripts v1.0.1)

**Decision**: Removed `scripts/generate-types.js` and switched to the `generate-types`
CLI from `@adrianhall/cloudflare-scripts` (pinned to `#v1.0.1`). Updated the
`generate:types` script in `package.json` to `generate-types -- --strict-vars=false`.

**Reason**: The `generate-types` CLI is the upstream-maintained version of the same
freshness-check logic. Maintaining a local copy is unnecessary duplication and means
manual porting of any upstream improvements.

**`worker-configuration.d.ts` moved to project root**: The file is now generated at
`./worker-configuration.d.ts` (alongside `wrangler.jsonc`) rather than
`src/worker-configuration.d.ts`. This lets `generate-types` use its standard freshness
check (comparing mtime of `wrangler.jsonc` vs `worker-configuration.d.ts` in the same
directory) without any `-d` flag gymnastics.

**`src/tsconfig.json` include change**: Added `"../worker-configuration.d.ts"` to the
`include` array so the `src` TypeScript project still picks up the generated `Env`
interface and workerd runtime types. TypeScript's `rootDir` constraint does not apply to
`.d.ts` declaration input files — only to emittable `.ts` source files — so this is
safe with `composite: true`.

**`biome.json` exclusion updated**: Changed `!src/worker-configuration.d.ts` to
`!worker-configuration.d.ts` to match the new root-level path.

**`postteardown` cleanup**: Added `worker-configuration.d.ts` to the `shx rm -f`
command so the generated types file is removed alongside `wrangler.jsonc` on teardown.

---

## ISSUE-07: Added `R2_BUCKET_NAME` var to `wrangler.jsonc.tpl`

**Decision**: Added `"R2_BUCKET_NAME": "{{r2_bucket_name}}"` to the `vars` block
in `wrangler.jsonc.tpl` and to the committed `worker-configuration.d.ts`.

**Reason**: `generatePresignedUrl` accepts `bucket: string` as an explicit
parameter — the R2 binding cannot be introspected for its name, so the caller
must supply it.  Without an env var, callers in ISSUE-08 and later workflow
steps would have to hardcode `"video-pipeline-bucket"`, which makes the project
brittle if the bucket is renamed and couples application code to infrastructure
details.  The `r2_bucket_name` Terraform output already exists and the
`{{r2_bucket_name}}` placeholder is already used in the `r2_buckets` binding; a
one-line addition to `vars` eliminates the hardcoding risk with zero extra
infrastructure cost.

**Implication**: After `npm run provision`, `wrangler.jsonc` will include
`R2_BUCKET_NAME` in `vars`, and `npm run generate:types` will regenerate
`worker-configuration.d.ts` with the real bucket name.  Callers of
`generatePresignedUrl` should use `env.R2_BUCKET_NAME` as the `bucket`
argument.

---

## ISSUE-13: `defaultPort` and `sleepAfter` are properties, not methods

**Decision**: Implemented `defaultPort` and `sleepAfter` as class property
assignments (`override defaultPort = 8080` and `override sleepAfter = 60`)
rather than as overridden methods (`defaultPort(): number` and
`sleepAfter(): number`) as shown in the issue's example code.

**Reason**: The `@cloudflare/containers` package (v0.3.5) declares both as
instance properties on the `Container` base class:

```ts
defaultPort?: number;
sleepAfter: string | number;
```

Implementing them as methods (`defaultPort(): number`) would assign function
values to `number` properties, causing a TypeScript type error under
`strict: true`. The Containers API is in beta and the issue itself notes that
"the exact base class and method signatures may change." Inspecting the
installed `node_modules/@cloudflare/containers/dist/lib/container.d.ts`
confirmed the property-based API.

The `sleepAfter` property accepts either a `number` (seconds) or a `string`
(e.g. `"1m"`, `"30s"`). ISSUE-13 specifies 60 seconds, so `sleepAfter = 60`
is used.

**Implication**: Any future code referencing `container.sleepAfter` should
treat it as a property of type `string | number`, not a callable method.

---

## ISSUE-15: biome.json `.wrangler` exclusion pattern corrected for biome v2.2+

**Decision**: Changed the `files.includes` exclusion pattern from `!**/.wrangler/` to `!.wrangler` in `biome.json`.

**Reason**: In biome v2.2.0+, the trailing `/**` suffix is no longer required to exclude a directory and all its descendants — using it triggers a new `lint/suspicious/useBiomeIgnoreFolder` warning. Additionally, the older pattern `!**/.wrangler/` (with a trailing slash) was found to not correctly exclude the contents of the `.wrangler/tmp/` directory in practice; biome was scanning generated wrangler build artefacts (`.wrangler/tmp/**/*.js`) and reporting hundreds of lint errors from third-party bundled code.

**Discovery**: The `.wrangler/tmp/` directory had been populated by a prior `wrangler dev` run. The exclusion bug was latent until those temp files existed. The corrected pattern `!.wrangler` excludes the root-level `.wrangler` directory and all its contents as of biome v2.2.0.

---

## ISSUE-18: Stream iframe URL derived from API response, not constructed from account ID

**Decision**: The `stream_url` stored in D1 is derived from `data.result.preview.replace("/watch", "/iframe")` rather than constructed as `https://customer-${env.CF_ACCOUNT_ID}.cloudflarestream.com/${uid}/iframe`.

**Reason**: The Cloudflare Stream "copy from URL" API response includes a `preview` field with the format `https://customer-<CODE>.cloudflarestream.com/<UID>/watch`. The `<CODE>` segment is a **customer subdomain** assigned by Cloudflare Stream and is distinct from the account ID. Using `CF_ACCOUNT_ID` as the customer code would produce an invalid URL. Deriving the iframe URL from the response's own `preview` field ensures the correct customer code is always used, without requiring an additional environment variable.

**Implementation**: `StreamApiResponse` is typed as a discriminated union that includes `result.preview` on the success branch. Replacing `/watch` with `/iframe` yields the standard embed URL expected by the Stream player.

**Implication**: The `CF_ACCOUNT_ID` env var is used only for the Stream API endpoint path (correct), not for URL construction. The frontend (ISSUE-22) should use `stream_video_id` for the `@cloudflare/stream-react` `<Stream src={...}>` prop and `stream_url` for the iframe embed.

---

## ISSUE-01/02: check:markdown scope narrowed to docs/**/*.md

**Decision**: The `check:markdown` script was changed from `'**/*.md' '#node_modules'` to `'docs/**/*.md' '#node_modules'` (by the operator, during ISSUE-02 execution).

**Reason**: The broad glob pattern scanned markdown files inside `.opencode/node_modules/` and `infra/.terraform/providers/` (downloaded by `terraform init`), both of which contain third-party README files with markdown violations that are not within the project's control. Scoping to `docs/**` restricts linting to authored documentation only.
