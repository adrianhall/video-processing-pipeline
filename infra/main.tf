# ── Credentials ───────────────────────────────────────────────────────────────
# Read Cloudflare credentials from .env at the project root.
# The dotenv provider makes each variable available as data.dotenv.env.env.VAR_NAME.

data "dotenv" "env" {
  filename = "../.env"
}

locals {
  account_id     = data.dotenv.env.env.CLOUDFLARE_ACCOUNT_ID
  api_token      = data.dotenv.env.env.CLOUDFLARE_API_TOKEN
  workers_domain = data.dotenv.env.env.CLOUDFLARE_WORKERS_DOMAIN
  team_domain    = data.dotenv.env.env.CLOUDFLARE_TEAM_DOMAIN
}

# ── Provider ──────────────────────────────────────────────────────────────────

provider "cloudflare" {
  api_token = local.api_token
}

# ── Permission Group Lookups ──────────────────────────────────────────────────
# Look up each required permission group by name so we can reference its ID
# when creating the R2 and Stream tokens below.
#
# Uses the account-level data source (cloudflare_account_api_token_permission_groups_list)
# rather than the user-level one (cloudflare_api_token_permission_groups_list), because
# the deployment API token in .env is account-scoped. The user-level endpoint returns
# 403 "Valid user-level authentication not found" for account-scoped tokens.
#
# The `name` parameter is passed as plain text — the provider URL-encodes it before
# sending the HTTP request. Passing a pre-encoded value (e.g. "Workers%20R2...") causes
# double-encoding (%2520) and the filter returns no results.

data "cloudflare_account_api_token_permission_groups_list" "r2_storage_write" {
  account_id = local.account_id
  name       = "Workers R2 Storage Write"
}

data "cloudflare_account_api_token_permission_groups_list" "stream_write" {
  account_id = local.account_id
  name       = "Stream Write"
}

# ── Worker Registration ───────────────────────────────────────────────────────
# Registers the Worker name with Cloudflare. Code is deployed separately by
# Wrangler — Terraform only manages the resource lifecycle (create/destroy).
#
# IMPORTANT: Use cloudflare_worker, not cloudflare_workers_script (legacy v4).
# The legacy resource does not reliably clean up on terraform destroy.

resource "cloudflare_worker" "worker" {
  account_id = local.account_id
  name       = "video-pipeline-worker"
}

# ── D1 Database ───────────────────────────────────────────────────────────────
# SQLite-compatible relational database for video metadata and pipeline status.
#
# IMPORTANT: Always include read_replication block. Without it, the Cloudflare
# API returns a read_replication object on every GET which causes Terraform to
# detect a diff on every subsequent apply.

resource "cloudflare_d1_database" "db" {
  account_id = local.account_id
  name       = "video-pipeline-db"

  read_replication = {
    mode = "disabled"
  }
}

# ── R2 Bucket ─────────────────────────────────────────────────────────────────
# Object storage for raw uploads, transcoded video, extracted audio, and
# grayscale output. Files are addressed by a key prefix convention:
#   incoming/{videoId}.{ext}  raw uploads
#   video/{videoId}.mp4       transcoded MP4
#   audio/{videoId}.mp3       extracted audio
#   bwvideo/{videoId}.mp4     grayscale video

resource "cloudflare_r2_bucket" "bucket" {
  account_id = local.account_id
  name       = "video-pipeline-bucket"
}

# ── R2 API Token ──────────────────────────────────────────────────────────────
# Used to generate S3-compatible presigned URLs for direct browser → R2 uploads
# and for Workflow step input/output transfers.
#
# token.id    → R2 S3 Access Key ID  (R2_ACCESS_KEY_ID wrangler var)
# token.value → R2 S3 Secret Key     (R2_SECRET_ACCESS_KEY wrangler var)
#
# Uses cloudflare_account_token (account-scoped) rather than cloudflare_api_token
# (user-scoped). The deployment API token in .env is account-scoped, so it has
# the "Account API Tokens Write" permission required to create account tokens,
# but not the user-level "API Tokens Write" permission required to create user tokens.

resource "cloudflare_account_token" "r2_token" {
  account_id = local.account_id
  name       = "video-pipeline-r2"

  policies = [{
    effect = "allow"
    permission_groups = [{
      id = data.cloudflare_account_api_token_permission_groups_list.r2_storage_write.result[0].id
    }]
    resources = jsonencode({
      "com.cloudflare.api.account.${local.account_id}" = "*"
    })
  }]
}

# ── Stream API Token ──────────────────────────────────────────────────────────
# Used by the VideoProcessingWorkflow to call the Stream copy-from-URL API
# which ingests the final grayscale video from R2 into Cloudflare Stream.
#
# token.value → CF_API_TOKEN wrangler var (Bearer token for Stream REST API)

resource "cloudflare_account_token" "stream_token" {
  account_id = local.account_id
  name       = "video-pipeline-stream"

  policies = [{
    effect = "allow"
    permission_groups = [{
      id = data.cloudflare_account_api_token_permission_groups_list.stream_write.result[0].id
    }]
    resources = jsonencode({
      "com.cloudflare.api.account.${local.account_id}" = "*"
    })
  }]
}
