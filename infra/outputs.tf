# ── Scalar Outputs for generate-wrangler ──────────────────────────────────────
# All outputs must be string type. The generate-wrangler tool reads these via
# `terraform output -json` and substitutes {{placeholder}} markers in
# wrangler.jsonc.tpl. Complex types (list, map, object) are not supported and
# will cause generate-wrangler to exit with code 7.
#
# Output names here must exactly match the {{placeholder}} identifiers used in
# wrangler.jsonc.tpl (case-sensitive).

output "account_id" {
  description = "Cloudflare account ID, used to scope all API calls and resource bindings."
  value       = local.account_id
}

output "worker_name" {
  description = "Name of the registered Worker, used as the wrangler `name` field."
  value       = cloudflare_worker.worker.name
}

output "d1_database_id" {
  description = "UUID of the D1 database instance, required for the d1_databases binding."
  value       = cloudflare_d1_database.db.id
}

output "d1_database_name" {
  description = "Human-readable name of the D1 database, used to identify the database in migrations and dashboard."
  value       = cloudflare_d1_database.db.name
}

output "r2_bucket_name" {
  description = "Name of the R2 bucket, used in the r2_buckets wrangler binding."
  value       = cloudflare_r2_bucket.bucket.name
}

output "team_domain" {
  description = "Cloudflare Access team domain (e.g. myteam.cloudflareaccess.com), injected as CLOUDFLARE_TEAM_DOMAIN wrangler var for JWT validation."
  value       = local.team_domain
}

output "workers_domain" {
  description = "Workers subdomain (e.g. myaccount.workers.dev), used for constructing the worker's public URL."
  value       = local.workers_domain
}

# ── Sensitive Token Outputs ───────────────────────────────────────────────────
# These outputs are marked sensitive=true so they are redacted in terraform plan
# and apply output. generate-wrangler reads them via `terraform output -json`
# which includes sensitive values in plaintext. The resulting wrangler.jsonc is
# gitignored. This is a deliberate demo convenience trade-off — a production
# system should use `wrangler secret put` or Secrets Store.

output "r2_token_id" {
  description = "R2 API token ID, used as the S3-compatible Access Key ID for presigned URL generation."
  value       = cloudflare_account_token.r2_token.id
  sensitive   = true
}

output "r2_token_value" {
  description = "SHA-256 hash of the R2 API token value, used as the S3-compatible Secret Access Key for presigned URL generation. R2's S3-compatible API requires the hash, not the raw token value — see https://developers.cloudflare.com/r2/api/tokens/"
  value       = sha256(cloudflare_account_token.r2_token.value)
  sensitive   = true
}

output "stream_token_value" {
  description = "Stream API token value, used as the Bearer token for the Stream copy-from-URL API calls made by VideoProcessingWorkflow."
  value       = cloudflare_account_token.stream_token.value
  sensitive   = true
}

output "access_aud" {
  description = "Audience tag for the Cloudflare Access application protecting the Worker. Used to verify the `aud` claim in Access JWTs during local debugging or additional validation layers."
  value       = cloudflare_zero_trust_access_application.video_pipeline_app.aud
  sensitive   = true
}
