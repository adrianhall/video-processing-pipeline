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
