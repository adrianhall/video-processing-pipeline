# Issue 27 — Container and Image Cleanup on Teardown

## Summary

`wrangler deploy` pushes a Docker image to Cloudflare's managed container
registry and creates a container application. `terraform destroy` does not know
about either of these resources, so they survive teardown and must be cleaned up
manually. Add a `preteardown` script that discovers the pipeline's container
application and registry images via the Cloudflare REST API and OCI registry
protocol, prompts the operator for confirmation, and deletes them.

## Relevant Skills

- `cloudflare`
- `cloudflare-scripts`
- `wrangler`

## Dependencies

- ISSUE-03 (container configuration in `wrangler.jsonc.tpl`)
- ISSUE-26 (establishes the `preteardown` lifecycle hook and bucket cleanup)

## Acceptance Criteria

- [ ] `scripts/cleanup-containers.mjs` exists and is executable via
      `node --env-file=.env scripts/cleanup-containers.mjs`
- [ ] The script reads `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
      from `.env` via Node.js `--env-file` flag
- [ ] The script lists container applications via the REST API and identifies
      the pipeline's container by matching name against the worker name
      (`video-pipeline-worker`)
- [ ] The script obtains temporary OCI registry credentials and lists image
      tags for the pipeline's image (`video-pipeline-worker-ffmpegcontainer`)
- [ ] If no container or images are found the script prints a message and
      exits with code 0
- [ ] If resources exist the script prints a summary and prompts
      `Delete all? (y/N)`
- [ ] If the operator confirms, all image tags are deleted via the OCI
      registry API and the container application is deleted via the REST API
- [ ] If the operator declines, the script exits with code 1 (halting
      teardown)
- [ ] If the REST API call fails (e.g. no containers deployed yet) the script
      prints a warning and exits with code 0
- [ ] `package.json` `preteardown` is updated to run both the bucket cleanup
      (ISSUE-26) and the container cleanup sequentially
- [ ] Running `npm run teardown` after a `wrangler deploy` prompts for both
      bucket and container cleanup before `terraform destroy`

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `scripts/cleanup-containers.mjs` | Added | Container application and image cleanup script |
| `package.json` | Modified | Update `preteardown` to run both cleanup scripts via `run-s` |

## Technical Implementation

### Two Distinct APIs

Containers span two separate APIs that use different authentication:

| Resource | API | Base URL | Auth |
|----------|-----|----------|------|
| Container applications | Cloudflare REST API | `https://api.cloudflare.com/client/v4/accounts/{id}/containers` | `Bearer {API_TOKEN}` |
| Container images (registry) | OCI Distribution spec | `https://registry.cloudflare.com` | `Basic {temp_creds}` |

Both are plain HTTP — no SDKs required, just `fetch()`.

### REST API Endpoints (Container Applications)

These endpoints are not yet published in the Cloudflare API reference but are
used internally by wrangler. The base path is
`/accounts/{account_id}/containers`.

| Operation | Method | Path |
|-----------|--------|------|
| List applications | `GET` | `/applications` |
| Delete application | `DELETE` | `/applications/{application_id}` |
| Generate registry credentials | (see OCI section below) | `/registries/registry.cloudflare.com/credentials` |

The response envelope matches the standard Cloudflare API shape:
`{ success: boolean, result: T, errors: [], messages: [] }`.

### OCI Registry Endpoints (Container Images)

The managed registry at `registry.cloudflare.com` follows the OCI Distribution
specification. Temporary credentials are obtained from the REST API, then used
as Basic auth for registry operations.

| Operation | Method | URL |
|-----------|--------|-----|
| Get temp credentials | `POST` | `https://api.cloudflare.com/client/v4/accounts/{id}/containers/registries/registry.cloudflare.com/credentials` |
| List repos + tags | `GET` | `https://registry.cloudflare.com/v2/_catalog?tags=true` |
| Delete image tag | `DELETE` | `https://registry.cloudflare.com/v2/{account_id}/{image}/manifests/{tag}` |

The credentials body is:

```json
{ "expiration_minutes": 5, "permissions": ["pull", "push"] }
```

The response contains a `password` field. Encode `v1:{password}` as Base64 for
the `Authorization: Basic {encoded}` header on subsequent registry calls.

Image tag deletion requires an `Accept` header:

```text
application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json
```

### Script Flow (`scripts/cleanup-containers.mjs`)

```javascript
#!/usr/bin/env node
/**
 * Cleans up container applications and images before teardown.
 *
 * Reads credentials from .env (via --env-file), discovers the pipeline's
 * container application and registry images via the Cloudflare REST API and
 * OCI registry protocol, prompts for confirmation, and deletes them.
 *
 * Exit codes:
 *   0 - nothing to clean up, or all resources deleted, or API unavailable
 *   1 - operator declined deletion
 */

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/containers`;
const REGISTRY = "registry.cloudflare.com";
const WORKER_NAME = "video-pipeline-worker";
```

#### Step 1 — List container applications

```javascript
const res = await fetch(`${API_BASE}/applications`, {
  headers: { Authorization: `Bearer ${API_TOKEN}` },
});
const { result: apps } = await res.json();
const pipelineApps = apps.filter((a) =>
  a.name?.includes(WORKER_NAME) || a.image?.includes(WORKER_NAME)
);
```

#### Step 2 — Obtain temporary registry credentials

```javascript
const credRes = await fetch(`${API_BASE}/registries/${REGISTRY}/credentials`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ expiration_minutes: 5, permissions: ["pull", "push"] }),
});
const { password } = (await credRes.json()).result;
const basicAuth = Buffer.from(`v1:${password}`).toString("base64");
```

#### Step 3 — List image tags from the OCI registry

```javascript
const catalogRes = await fetch(
  `https://${REGISTRY}/v2/_catalog?tags=true`,
  { headers: { Authorization: `Basic ${basicAuth}` } },
);
const { repositories } = await catalogRes.json();
// Filter to pipeline images (e.g. "video-pipeline-worker-ffmpegcontainer")
const pipelineRepos = repositories.filter((r) => r.name.includes(WORKER_NAME));
```

#### Step 4 — Prompt

Print the count of containers and image tags. Prompt `Delete all? (y/N)`.

#### Step 5 — Delete image tags via OCI registry

For each repo/tag pair, send `DELETE` with the `Accept` header for OCI
manifests.

#### Step 6 — Delete container applications via REST API

```javascript
await fetch(`${API_BASE}/applications/${app.id}`, {
  method: "DELETE",
  headers: { Authorization: `Bearer ${API_TOKEN}` },
});
```

### `package.json` Changes

ISSUE-26 sets `preteardown` to a single script. This issue replaces it with
`run-s` to run both cleanup scripts sequentially:

```jsonc
"preteardown": "run-s preteardown:*",
"preteardown:bucket": "node scripts/empty-bucket.mjs",
"preteardown:containers": "node --env-file=.env scripts/cleanup-containers.mjs",
```

`run-s` (from `npm-run-all2`, already a devDependency) runs scripts
alphabetically and fails fast — if bucket cleanup fails, container cleanup is
skipped. `--env-file=.env` is a Node.js built-in flag (stable since v21.7)
that loads `.env` variables into `process.env` with zero dependencies.

### Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `.env` missing or credentials empty | `fetch()` returns 401; caught, prints warning, exits 0 |
| No containers found (never deployed) | Prints "No containers found", exits 0 |
| No images found in registry | Prints "No images found", exits 0 |
| Operator types `y` | Deletes all images and containers, exits 0 |
| Operator types anything else | Prints abort message, exits 1 (halts teardown) |
| API returns non-2xx on delete | Logs error per item, continues with remaining; exits 1 if any failures |

## Manual Tests

1. Deploy the worker with `npm run deploy` so a container application and
   registry image exist
2. Verify `npx wrangler containers list` shows a container and
   `npx wrangler containers images list` shows the image
3. Run `npm run teardown` — the script should print the container and image
   summary and prompt for confirmation
4. Type `n` — teardown should abort and resources should remain intact
5. Run `npm run teardown` again and type `y` — container and images should be
   deleted, then `terraform destroy` should succeed
6. Run `npm run teardown` on a project that was never deployed (no containers
   exist) — the script should print "No containers found" and skip gracefully

## Other Notes

- The Containers REST API (`/accounts/{id}/containers/applications`) and the
  OCI registry credentials endpoint are not yet listed in the public Cloudflare
  API reference. The endpoint paths were verified from the wrangler source code
  (`wrangler-dist/cli.js`, `containers-shared/` modules). If the API changes,
  update the endpoint constants in the script.
- The managed registry at `registry.cloudflare.com` uses the OCI Distribution
  specification. Image tag deletion requires first resolving the manifest
  digest via a `HEAD` request with the appropriate `Accept` header, then
  issuing a `DELETE` against the same URL. Wrangler's `containers images
  delete` command follows this same two-step process.
- Container applications are distinct from the Worker and Durable Object
  resources managed by Terraform. Deleting a container application via the API
  removes it from the Containers dashboard but does not affect the Worker or
  DO bindings (which Terraform destroys separately).
- The `--env-file=.env` approach requires Node.js 21.7+. The project's
  `@types/node ^25.9.1` implies a compatible Node.js version. If Node.js
  compatibility is a concern, `dotenv` can be added as an alternative.
- Image storage in the managed registry is backed by R2 and counts toward
  registry storage limits. Cleaning up unused images frees this space.
