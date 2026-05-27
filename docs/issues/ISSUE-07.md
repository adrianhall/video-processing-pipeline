# Issue 07 — R2 Presigned URL Utility

## Summary

Create a reusable utility function that generates presigned GET and PUT URLs for R2 objects using the S3-compatible API. This is used by the upload API (ISSUE-08) and by every Workflow step that communicates with the Container (ISSUE-15 through ISSUE-17).

## Relevant Skills

- `cloudflare`
- `workers-best-practices`
- `typescript-advanced-types`

## Dependencies

- ISSUE-05 (Hono app with Env type that includes `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `BUCKET`)

## Acceptance Criteria

- [ ] `src/lib/presigned.ts` exports a `generatePresignedUrl` function
- [ ] The function accepts: `env: Env`, `key: string`, `method: "GET" | "PUT"`, and optional `expiresIn: number` (defaults to 3600 seconds)
- [ ] It uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (or `aws4fetch`) to generate an S3-compatible presigned URL against the R2 endpoint
- [ ] The R2 S3 endpoint is constructed as `https://${env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`
- [ ] The bucket name is derived from the `BUCKET` binding's name (passed as a parameter or read from env)
- [ ] `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are added to `dependencies`
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/lib/presigned.ts` | Added | Presigned URL generation utility |
| `package.json` | Modified | Add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |

## Technical Implementation

### Function Signature

```typescript
export async function generatePresignedUrl(
  env: Env,
  bucket: string,
  key: string,
  method: "GET" | "PUT",
  expiresIn?: number
): Promise<string>
```

### Implementation Notes

- Use `S3Client` from `@aws-sdk/client-s3` configured with the R2 endpoint, `env.R2_ACCESS_KEY_ID`, and `env.R2_SECRET_ACCESS_KEY`.
- Use `getSignedUrl` from `@aws-sdk/s3-request-presigner` with either `GetObjectCommand` (for GET) or `PutObjectCommand` (for PUT).
- The `region` should be `"auto"` for R2.
- Default expiry is 1 hour (3600 seconds) — sufficient for container download/upload operations.
- The `nodejs_compat` flag in `wrangler.jsonc.tpl` (ISSUE-03) is required for these AWS SDK packages to work in the Workers runtime.

### Bucket Name

The R2 bucket name must be passed explicitly (it is known at the call site from the Terraform output). Do not try to introspect the `BUCKET` binding for its name — the binding is for direct R2 API access, but presigned URLs use the S3-compatible API which needs the bucket name string.

## Manual Tests

1. Run `npm run check` — passes (types and lint clean)
2. Inspect `src/lib/presigned.ts` — function is exported, uses `@aws-sdk/s3-request-presigner`

## Other Notes

This function cannot be fully tested until secrets are set via `wrangler secret put`. Integration testing will be covered in ISSUE-24. Unit tests can mock the S3 client if needed.
