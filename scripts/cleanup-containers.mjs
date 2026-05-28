#!/usr/bin/env node
/**
 * Cleans up container applications and registry images before teardown.
 *
 * Reads credentials from `.env` (via Node.js `--env-file` flag), discovers
 * the pipeline's container application and OCI registry images via the
 * Cloudflare REST API and OCI Distribution specification, prompts for
 * confirmation, and deletes them.
 *
 * Two separate APIs are used:
 *   - Cloudflare REST API  (`api.cloudflare.com`) for container applications
 *   - OCI registry API    (`registry.cloudflare.com`) for image manifests
 *
 * Exit codes:
 *   0 - nothing to clean up, or all resources deleted, or API unavailable
 *   1 - operator declined deletion, or one or more deletions failed
 */

import { createInterface } from "node:readline/promises";

// -- Constants ----------------------------------------------------------------

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/containers`;
const REGISTRY = "registry.cloudflare.com";
const WORKER_NAME = "video-pipeline-worker";

/**
 * Accept header required for OCI manifest HEAD and DELETE requests.
 * Includes both OCI and Docker v2 manifest media types so the registry
 * can return whichever format the image was pushed with.
 */
const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

// -- Credential validation ----------------------------------------------------

if (!ACCOUNT_ID || !API_TOKEN) {
  console.log(
    "Warning: CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not set in .env. " +
      "Skipping container cleanup.",
  );
  process.exit(0);
}

// -- Step 1: List container applications via REST API -------------------------

/**
 * Fetches all container applications for the account and returns those
 * whose name or image reference contains the pipeline worker name.
 *
 * @returns {Promise<Array<{id: string, name?: string, image?: string}>>}
 *   Matching container application objects, or an empty array if the API
 *   is unavailable or no containers have been deployed yet.
 */
async function listPipelineApps() {
  let res;
  try {
    res = await fetch(`${API_BASE}/applications`, {
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
  } catch (err) {
    console.log(
      `Warning: Could not reach container API (${/** @type {Error} */ (err).message}). ` +
        "Skipping container cleanup.",
    );
    return null; // signals caller to exit 0
  }

  if (!res.ok) {
    console.log(
      `Warning: Container applications API returned HTTP ${res.status}. ` +
        "Skipping container cleanup.",
    );
    return null;
  }

  const { result: apps } =
    /** @type {{ result: Array<{id: string, name?: string, image?: string}> }} */ (
      await res.json()
    );

  return (apps ?? []).filter(
    (a) => a.name?.includes(WORKER_NAME) || a.image?.includes(WORKER_NAME),
  );
}

// -- Step 2: Obtain temporary OCI registry credentials -----------------------

/**
 * Requests short-lived (5-minute) OCI registry credentials from the
 * Cloudflare containers API and returns a Base64-encoded Basic auth string
 * suitable for use in `Authorization: Basic {value}` headers.
 *
 * The format required by `registry.cloudflare.com` is `v1:{password}`
 * encoded as Base64, not the plain `username:password` form.
 *
 * @returns {Promise<string | null>} Encoded Basic auth value, or `null` if
 *   credentials could not be obtained (caller skips registry operations).
 */
async function getRegistryAuth() {
  let res;
  try {
    res = await fetch(`${API_BASE}/registries/${REGISTRY}/credentials`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expiration_minutes: 5,
        permissions: ["pull", "push"],
      }),
    });
  } catch (err) {
    console.log(
      `Warning: Registry credential request failed (${/** @type {Error} */ (err).message}).`,
    );
    return null;
  }

  if (!res.ok) {
    console.log(
      `Warning: Registry credentials API returned HTTP ${res.status}.`,
    );
    return null;
  }

  const { result } = /** @type {{ result: { password?: string } }} */ (
    await res.json()
  );
  if (!result?.password) {
    console.log(
      "Warning: Registry credentials response did not include a password.",
    );
    return null;
  }

  return Buffer.from(`v1:${result.password}`).toString("base64");
}

// -- Step 3: List pipeline image repos + tags from OCI registry --------------

/**
 * Queries the OCI `_catalog` endpoint with `tags=true` (Cloudflare extension)
 * to enumerate all repositories and their tags, then filters to those
 * belonging to the pipeline worker.
 *
 * **Response format**: Unlike the standard OCI `_catalog` (which returns an
 * array of strings), `registry.cloudflare.com` with `?tags=true` returns a
 * **dictionary** where each key is a repo path (e.g. `/{accountId}/{image}`,
 * potentially with a leading `/`) and each value is a flat array of tag strings
 * that includes both human-readable tags (`latest`, …) and sha256 digest
 * entries (`sha256:abc123…`). This mirrors how `wrangler containers images list`
 * parses the same endpoint.
 *
 * Only human-readable tags (those not starting with `sha256:`) are returned for
 * deletion. Deleting a human-readable tag by its content digest (the two-step
 * process) removes the underlying manifest, making the sha256 entries orphaned
 * and eligible for registry garbage collection.
 *
 * @param {string} basicAuth - Base64-encoded Basic auth string from {@link getRegistryAuth}.
 * @returns {Promise<Array<{name: string, tags: string[]}>>}
 *   Matching repository objects, each with a normalised `name` (leading `/`
 *   stripped) and a `tags` array of human-readable tag strings.
 */
async function listPipelineRepos(basicAuth) {
  let res;
  try {
    res = await fetch(`https://${REGISTRY}/v2/_catalog?tags=true`, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });
  } catch (err) {
    console.log(
      `Warning: Could not reach registry catalog (${/** @type {Error} */ (err).message}).`,
    );
    return [];
  }

  if (!res.ok) {
    console.log(`Warning: Registry catalog returned HTTP ${res.status}.`);
    return [];
  }

  const { repositories } =
    /** @type {{ repositories: Record<string, string[]> }} */ (
      await res.json()
    );

  // `repositories` is a dictionary: { "/accountId/imageName": ["latest", "sha256:…"] }
  const repos = repositories ?? {};
  const result = [];

  for (const [repoPath, allTags] of Object.entries(repos)) {
    // Strip any leading "/" from the path returned by the registry
    const name = repoPath.replace(/^\/+/, "");
    if (!name.includes(WORKER_NAME)) {
      continue;
    }
    // Exclude sha256 digest entries — we only need to delete human-readable tags.
    // Deleting by digest (via the HEAD step) removes the manifest content itself.
    const humanTags = (Array.isArray(allTags) ? allTags : []).filter(
      (t) => !t.startsWith("sha256:"),
    );
    if (humanTags.length > 0) {
      result.push({ name, tags: humanTags });
    }
  }

  return result;
}

// -- Step 5: Delete a single image tag via OCI two-step protocol -------------

/**
 * Deletes one image tag from the registry using the OCI two-step process:
 * 1. `HEAD /manifests/{tag}` to resolve the content digest.
 * 2. `DELETE /manifests/{digest}` to remove the manifest by its immutable digest.
 *
 * Deleting by digest (rather than by tag) is required by the OCI Distribution
 * specification and is the approach used by `wrangler containers images delete`.
 *
 * @param {string} basicAuth - Base64-encoded Basic auth string.
 * @param {string} repoName  - Repository name as returned by `_catalog` (e.g.
 *   `{accountId}/{imageName}`).
 * @param {string} tag       - Tag to delete (e.g. `latest`).
 * @returns {Promise<boolean>} `true` if the tag was deleted successfully, `false` on error.
 */
async function deleteImageTag(basicAuth, repoName, tag) {
  const tagUrl = `https://${REGISTRY}/v2/${repoName}/manifests/${tag}`;

  // Step 5a: Resolve manifest digest via HEAD
  let digest = null;
  try {
    const headRes = await fetch(tagUrl, {
      method: "HEAD",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: MANIFEST_ACCEPT,
      },
    });
    if (headRes.ok) {
      digest = headRes.headers.get("Docker-Content-Digest");
    } else {
      console.log(
        `  Warning: HEAD ${tagUrl} returned HTTP ${headRes.status} — will try delete by tag.`,
      );
    }
  } catch (err) {
    console.log(
      `  Warning: HEAD ${tagUrl} failed (${/** @type {Error} */ (err).message}) — will try delete by tag.`,
    );
  }

  // Step 5b: DELETE by digest (preferred) or fall back to delete by tag
  const deleteUrl = digest
    ? `https://${REGISTRY}/v2/${repoName}/manifests/${digest}`
    : tagUrl;

  try {
    const delRes = await fetch(deleteUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        Accept: MANIFEST_ACCEPT,
      },
    });
    // 202 Accepted is also a success response for some registry implementations
    if (delRes.ok || delRes.status === 202) {
      console.log(`  Deleted image tag ${repoName}:${tag}`);
      return true;
    }
    console.log(`  Error: DELETE ${deleteUrl} returned HTTP ${delRes.status}.`);
    return false;
  } catch (err) {
    console.log(
      `  Error: DELETE ${deleteUrl} failed (${/** @type {Error} */ (err).message}).`,
    );
    return false;
  }
}

// -- Step 6: Delete a container application via REST API --------------------

/**
 * Deletes a container application by its ID using the Cloudflare containers
 * REST API. Logs the result and returns whether the deletion succeeded.
 *
 * @param {{ id: string, name?: string }} app - Container application object.
 * @returns {Promise<boolean>} `true` if deleted successfully, `false` on error.
 */
async function deleteContainerApp(app) {
  const label = app.name ?? app.id;
  try {
    const delRes = await fetch(`${API_BASE}/applications/${app.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${API_TOKEN}` },
    });
    // 204 No Content is the standard success response for DELETE
    if (delRes.ok || delRes.status === 204) {
      console.log(`  Deleted container application: ${label}`);
      return true;
    }
    console.log(
      `  Error: DELETE application "${label}" returned HTTP ${delRes.status}.`,
    );
    return false;
  } catch (err) {
    console.log(
      `  Error: DELETE application "${label}" failed (${/** @type {Error} */ (err).message}).`,
    );
    return false;
  }
}

// -- Main flow ----------------------------------------------------------------

// Step 1: Discover container applications
const pipelineApps = await listPipelineApps();
if (pipelineApps === null) {
  // API unavailable — exit 0 so terraform destroy can still run
  process.exit(0);
}

// Steps 2–3: Discover registry images (skip gracefully if credentials fail)
const basicAuth = await getRegistryAuth();
const pipelineRepos = basicAuth ? await listPipelineRepos(basicAuth) : [];

// Count total tags across all matching repos
const totalTags = pipelineRepos.reduce((n, r) => n + r.tags.length, 0);

// Nothing to do?
if (pipelineApps.length === 0 && totalTags === 0) {
  console.log(
    "No container applications or registry images found. Nothing to clean up.",
  );
  process.exit(0);
}

// Step 4: Print summary and prompt the operator
console.log(
  `Found ${pipelineApps.length} container application(s) and ${totalTags} image tag(s) to delete:`,
);
for (const app of pipelineApps) {
  console.log(`  Container app: ${app.name ?? app.id}`);
}
for (const repo of pipelineRepos) {
  for (const tag of repo.tags) {
    console.log(`  Image: ${repo.name}:${tag}`);
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question("\nDelete all? (y/N) ");
rl.close();

if (answer.trim().toLowerCase() !== "y") {
  console.log("Aborted. Resources were not deleted — teardown will halt.");
  process.exit(1);
}

// Steps 5–6: Delete everything, tracking failures
let failures = 0;

// Delete image tags first (images must be removed before the app in some registry implementations)
if (basicAuth) {
  for (const repo of pipelineRepos) {
    for (const tag of repo.tags) {
      const ok = await deleteImageTag(basicAuth, repo.name, tag);
      if (!ok) {
        failures++;
      }
    }
  }
}

// Delete container applications
for (const app of pipelineApps) {
  const ok = await deleteContainerApp(app);
  if (!ok) {
    failures++;
  }
}

if (failures > 0) {
  console.log(`\n${failures} deletion(s) failed. Review the errors above.`);
  process.exit(1);
}

console.log("\nContainer cleanup complete.");
