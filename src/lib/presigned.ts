/**
 * R2 presigned URL utility.
 *
 * Generates time-limited, pre-authenticated GET and PUT URLs for objects in
 * Cloudflare R2 using the S3-compatible API.  These URLs allow untrusted
 * clients (browsers, containers) to read or write a specific R2 object
 * without requiring direct access to the R2 binding or long-lived credentials.
 *
 * ## Prerequisites
 * - `nodejs_compat` must be enabled in `wrangler.jsonc` — the AWS SDK v3
 *   packages depend on Node.js crypto and stream built-ins that are only
 *   available under that compatibility flag.
 * - `env.CF_ACCOUNT_ID`, `env.R2_ACCESS_KEY_ID`, and
 *   `env.R2_SECRET_ACCESS_KEY` must be populated via the `vars` block in
 *   `wrangler.jsonc`.  They are injected by `generate-wrangler` from the
 *   Terraform-managed R2 API token.
 *
 * @module lib/presigned
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Default presigned URL lifetime in seconds (1 hour). */
const DEFAULT_EXPIRES_IN = 3600;

/**
 * Generates a presigned S3-compatible URL for an R2 object.
 *
 * The URL grants time-limited, single-operation access to a specific key in
 * the named bucket.  A `"PUT"` URL allows a client to upload a file directly
 * to R2 without routing the body through the Worker (which is limited to
 * 100 MB).  A `"GET"` URL allows a container or browser to download the
 * object without needing the R2 binding.
 *
 * A new `S3Client` instance is created on every call so that the credentials
 * from `env` are never captured in module-level state — in the Workers
 * runtime, module-level variables are shared across requests and isolates,
 * which could expose credentials between tenants.
 *
 * @param env - The Worker environment, supplying the account ID and R2 API
 *   credentials needed to sign the request.
 * @param bucket - The R2 bucket name as a plain string (e.g.
 *   `"video-pipeline-bucket"`).  This must match the `bucket_name` in
 *   `wrangler.jsonc`.  The `BUCKET` binding cannot be introspected for its
 *   name — pass it explicitly at the call site.
 * @param key - The R2 object key (path) to sign, e.g.
 *   `"incoming/01960b1e.mkv"`.
 * @param method - Whether to generate a download (`"GET"`) or upload
 *   (`"PUT"`) URL.
 * @param expiresIn - How long (in seconds) the signed URL remains valid.
 *   Defaults to `3600` (1 hour), which is sufficient for container
 *   download/upload operations on large video files.  R2 enforces a maximum
 *   of 7 days (604 800 seconds).
 * @returns A fully-signed HTTPS URL that the recipient can use directly with
 *   a standard HTTP client — no additional authentication headers are
 *   required.
 *
 * @example
 * ```ts
 * // Generate a PUT URL so the browser can upload directly to R2
 * const uploadUrl = await generatePresignedUrl(
 *   env,
 *   "video-pipeline-bucket",
 *   "incoming/01960b1e-4a7b-7d99-b90c-12e0f73c69d0.mkv",
 *   "PUT",
 * );
 *
 * // Generate a GET URL so the ffmpeg container can download the source file
 * const downloadUrl = await generatePresignedUrl(
 *   env,
 *   "video-pipeline-bucket",
 *   "incoming/01960b1e-4a7b-7d99-b90c-12e0f73c69d0.mkv",
 *   "GET",
 * );
 * ```
 */
export async function generatePresignedUrl(
  env: Env,
  bucket: string,
  key: string,
  method: "GET" | "PUT",
  expiresIn: number = DEFAULT_EXPIRES_IN,
): Promise<string> {
  // A new client is created per call — see JSDoc above for why module-level
  // state is intentionally avoided here.
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });

  const command =
    method === "PUT"
      ? new PutObjectCommand({ Bucket: bucket, Key: key })
      : new GetObjectCommand({ Bucket: bucket, Key: key });

  return getSignedUrl(s3, command, { expiresIn });
}
