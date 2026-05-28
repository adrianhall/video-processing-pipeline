# Issue 26 — R2 Bucket Cleanup on Teardown

## Summary

`terraform destroy` cannot delete an R2 bucket that contains objects — the
Cloudflare API returns an error and the destroy fails part-way through, leaving
resources in a broken state. Add a `preteardown` script that lists every object
in the pipeline's R2 bucket, prompts the operator for confirmation, and
batch-deletes all objects before Terraform runs.

## Relevant Skills

- `cloudflare`
- `cloudflare-scripts`
- `wrangler`

## Dependencies

- ISSUE-02 (R2 bucket and API token provisioned by Terraform)

## Acceptance Criteria

- [ ] `scripts/empty-bucket.mjs` exists and is executable via `node scripts/empty-bucket.mjs`
- [ ] The script reads R2 S3 credentials and bucket name from `terraform -chdir=infra output -json`
- [ ] The script lists all objects in the bucket using `ListObjectsV2Command` with pagination
- [ ] If the bucket is empty the script prints a message and exits with code 0
- [ ] If objects exist the script prints the count and prompts `Delete all? (y/N)`
- [ ] If the operator confirms, all objects are batch-deleted (up to 1000 per request via `DeleteObjectsCommand`)
- [ ] If the operator declines, the script exits with code 1 (halting teardown)
- [ ] If `terraform output` fails (state missing or already destroyed) the script prints a warning and exits with code 0
- [ ] `package.json` has a `preteardown` script that runs the empty-bucket script
- [ ] Running `npm run teardown` on a bucket with objects prompts before deleting

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `scripts/empty-bucket.mjs` | Added | Interactive R2 bucket cleanup script using S3-compatible API |
| `package.json` | Modified | Add `preteardown` lifecycle script |

## Technical Implementation

### Approach Decision

Three approaches were evaluated:

| Approach | Pros | Cons |
|----------|------|------|
| Wrangler CLI (`wrangler r2 object delete`) | No code needed | Deletes one object at a time; no batch support; very slow |
| Cloudflare REST API (`fetch`) | No SDK dependency | Manual auth headers, pagination, and request body construction |
| **S3-compatible SDK (`@aws-sdk/client-s3`)** | **Already installed; paginated listing + batch delete; type-safe** | Requires R2 S3 credentials from Terraform output |

**Winner: S3 SDK** — zero new dependencies (the package is already in
`dependencies`), `ListObjectsV2Command` handles pagination,
`DeleteObjectsCommand` handles batch delete (up to 1000 keys per request), and
the pattern is consistent with the existing presigned-URL code in
`src/lib/presigned.ts`.

### Credential Retrieval

The script runs as `preteardown`, so Terraform state and the R2 API token still
exist. All four values come from a single `terraform output -json` call:

| Terraform output | Usage |
|------------------|-------|
| `account_id` | S3 endpoint: `https://{account_id}.r2.cloudflarestorage.com` |
| `r2_bucket_name` | Bucket name for list/delete commands |
| `r2_token_id` | S3 `accessKeyId` |
| `r2_token_value` | S3 `secretAccessKey` (already SHA-256 hashed in `outputs.tf`) |

No `.env` parsing or additional dependencies are required.

### `scripts/empty-bucket.mjs`

```javascript
#!/usr/bin/env node
/**
 * Empties the R2 bucket before teardown.
 *
 * Reads credentials from `terraform output`, lists all objects via the
 * S3-compatible API, prompts for confirmation, and batch-deletes in
 * groups of 1000.
 *
 * Exit codes:
 *   0 - bucket already empty, or all objects deleted, or terraform state missing
 *   1 - operator declined deletion
 */

import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

/** Maximum keys per DeleteObjects request (S3/R2 limit). */
const BATCH_SIZE = 1000;

// -- 1. Read Terraform outputs ------------------------------------------------

let outputs;
try {
  const raw = execSync("terraform -chdir=infra output -json", {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  outputs = JSON.parse(raw);
} catch {
  console.log("Warning: Terraform state not found. Skipping bucket cleanup.");
  process.exit(0);
}

const accountId = outputs.account_id.value;
const bucketName = outputs.r2_bucket_name.value;
const accessKeyId = outputs.r2_token_id.value;
const secretAccessKey = outputs.r2_token_value.value;

// -- 2. Create S3 client ------------------------------------------------------

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

// -- 3. List all object keys (paginated) --------------------------------------

const allKeys = [];
let continuationToken;
do {
  const res = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    }),
  );
  if (res.Contents) {
    allKeys.push(...res.Contents.map((o) => o.Key));
  }
  continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
} while (continuationToken);

if (allKeys.length === 0) {
  console.log(`Bucket "${bucketName}" is already empty.`);
  process.exit(0);
}

// -- 4. Prompt operator -------------------------------------------------------

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  `${allKeys.length} object(s) in "${bucketName}". Delete all? (y/N) `,
);
rl.close();

if (answer.trim().toLowerCase() !== "y") {
  console.log("Aborted. Bucket was not emptied — teardown will fail.");
  process.exit(1);
}

// -- 5. Batch delete ----------------------------------------------------------

for (let i = 0; i < allKeys.length; i += BATCH_SIZE) {
  const batch = allKeys.slice(i, i + BATCH_SIZE);
  await s3.send(
    new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: { Objects: batch.map((Key) => ({ Key })) },
    }),
  );
  console.log(
    `Deleted ${Math.min(i + BATCH_SIZE, allKeys.length)}/${allKeys.length}`,
  );
}

console.log(`Bucket "${bucketName}" emptied.`);
```

### `package.json` Change

Add a single `preteardown` script. npm lifecycle hooks guarantee execution
order: `preteardown` -> `teardown` -> `postteardown`.

```jsonc
"preteardown": "node scripts/empty-bucket.mjs",
"teardown": "terraform -chdir=infra destroy -auto-approve",              // existing
"postteardown": "shx rm -f wrangler.jsonc worker-configuration.d.ts",    // existing
```

### Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Terraform state missing (already destroyed) | Print warning, exit 0 (teardown still runs; Terraform reports "nothing to destroy") |
| Bucket is empty | Print message, exit 0 |
| Operator types `y` | Batch-delete all objects, exit 0 |
| Operator types anything else / `n` | Print abort message, exit 1 (halts teardown) |
| S3 `ListObjectsV2` or `DeleteObjects` throws | Unhandled rejection exits Node.js with code 1 (halts teardown) |

## Manual Tests

1. Provision infrastructure and upload at least one video so the R2 bucket contains objects
2. Run `npm run teardown` — the script should print the object count and prompt for confirmation
3. Type `n` — teardown should abort and infrastructure should remain intact
4. Run `npm run teardown` again and type `y` — all objects should be deleted and `terraform destroy` should succeed
5. Run `npm run teardown` on an already-torn-down project (no Terraform state) — the script should print a warning and skip gracefully

## Other Notes

- The Cloudflare Terraform provider v5 does not expose a `force_destroy`
  attribute on `cloudflare_r2_bucket` (unlike AWS's `aws_s3_bucket`). A
  pre-teardown script is the only reliable way to empty the bucket before
  destroy.
- The `DeleteObjectsCommand` limit of 1000 keys per request is an S3 API
  constraint that R2 also enforces. The pagination loop in the listing step
  and the batching loop in the delete step handle buckets of any size.
- For non-interactive CI pipelines, the script could be extended with a
  `--force` flag that skips the confirmation prompt. This is not required for
  the blog demo and can be added as a follow-up if needed.
- The script does **not** delete the bucket itself — that is Terraform's
  responsibility during `terraform destroy`.
- Top-level `await` works because the project sets `"type": "module"` in
  `package.json` and the file uses the `.mjs` extension.
