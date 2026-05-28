{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "{{worker_name}}",
  "main": "src/index.ts",
  "compatibility_date": "2025-05-01",
  "compatibility_flags": ["nodejs_compat"],
  "account_id": "{{account_id}}",

  // Disable preview URLs deliberately.
  "preview_urls": false,

  // Observability: capture all requests during development (head_sampling_rate: 1 = 100%).
  // Reduce to 0.1 (10%) or lower for a production deployment to control log volume.
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },

  // Plaintext vars populated by generate-wrangler from Terraform outputs.
  // The generated wrangler.jsonc is gitignored so these tokens never enter
  // version control. A production system should use `wrangler secret put` or
  // Secrets Store instead.
  "vars": {
    "CLOUDFLARE_TEAM_DOMAIN": "{{team_domain}}",
    "CF_ACCOUNT_ID": "{{account_id}}",
    "R2_BUCKET_NAME": "{{r2_bucket_name}}",
    "R2_ACCESS_KEY_ID": "{{r2_token_id}}",
    "R2_SECRET_ACCESS_KEY": "{{r2_token_value}}"
  },

  // Assets binding for the React SPA.
  // directory: the folder Wrangler uploads as static assets; in dev this is the
  //   placeholder public/index.html; in production it is the Vite build output.
  // run_worker_first: true — required by cloudflare-auth. All requests (including
  //   the initial page load) must flow through the Worker middleware chain so the
  //   auth cookie is set before the SPA makes API calls.
  // not_found_handling: "single-page-application" — required for client-side routing
  //   so that refreshing a deep URL (e.g. /videos/123) serves index.html rather than 404.
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": true
  },

  // D1 database binding for video metadata storage.
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "{{d1_database_name}}",
      "database_id": "{{d1_database_id}}"
    }
  ],

  // R2 bucket binding for raw uploads and processed video files.
  "r2_buckets": [
    {
      "binding": "BUCKET",
      "bucket_name": "{{r2_bucket_name}}"
    }
  ],

  // Workflow binding for the multi-step video processing pipeline.
  // class_name must match the class exported from src/workflow.ts.
  "workflows": [
    {
      "binding": "VIDEO_WORKFLOW",
      "name": "video-processing-workflow",
      "class_name": "VideoProcessingWorkflow"
    }
  ],

  // Container configuration for the ffmpeg processing container.
  // class_name must match the class exported from src/container.ts.
  // image points to the Dockerfile; the binding name lives in durable_objects below.
  "containers": [
    {
      "class_name": "FFmpegContainer",
      "image": "./container/Dockerfile"
    }
  ],

  // Durable Object binding that exposes the container class to Worker code as
  // env.FFMPEG_CONTAINER. The class_name must match the containers entry above.
  "durable_objects": {
    "bindings": [
      {
        "name": "FFMPEG_CONTAINER",
        "class_name": "FFmpegContainer"
      }
    ]
  },

  // DO migrations: registers FFmpegContainer as a SQLite-backed class.
  // new_sqlite_classes is required for Container-backed Durable Objects.
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["FFmpegContainer"]
    }
  ]
}
