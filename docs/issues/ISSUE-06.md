# Issue 06 — Static Asset Serving

## Summary

Create a minimal `public/index.html` placeholder so that the Worker can serve static assets via the ASSETS binding. After this issue, `npm start` (which runs `wrangler dev`) will serve the placeholder page through the auth middleware chain. This is the first issue where `npm start` works end-to-end.

## Relevant Skills

- `cloudflare`
- `wrangler`
- `workers-best-practices`

## Dependencies

- ISSUE-05 (Hono app with catch-all `ASSETS.fetch` route)

## Acceptance Criteria

- [ ] `public/index.html` exists with a minimal valid HTML5 page (title: "Video Processing Pipeline", body: a heading and "Loading..." placeholder)
- [ ] `public/` directory is no longer gitignored (or an exception is added for `index.html`) — this placeholder is committed; later ISSUE-19 will make `public/` the Vite build output directory and re-gitignore it
- [ ] `npm run check` passes
- [ ] `npm start` serves the placeholder page at `http://localhost:8787` (requires a local wrangler.jsonc — see Other Notes)

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `public/index.html` | Added | Minimal HTML5 placeholder |
| `.gitignore` | Modified | Ensure `public/index.html` is tracked (not ignored) |

## Technical Implementation

### `public/index.html`

A minimal HTML5 document:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Video Processing Pipeline</title>
</head>
<body>
  <h1>Video Processing Pipeline</h1>
  <p>Loading...</p>
</body>
</html>
```

This placeholder will be replaced by the Vite build output in ISSUE-19.

### .gitignore

The current `.gitignore` may already exclude `public/` or `dist/`. Adjust so that `public/index.html` is tracked. In ISSUE-19, once Vite outputs to `public/`, the gitignore will be updated to ignore generated files while keeping the directory.

## Manual Tests

1. Run `npm start` — opens `http://localhost:8787`, shows the placeholder HTML
2. Visit `http://localhost:8787/api/version` — returns `{ "version": "1.0.0" }` (no auth required)

## Other Notes

`npm start` requires a working `wrangler.jsonc`. If infrastructure hasn't been provisioned yet, create a minimal local `wrangler.jsonc` manually for development (without real D1/R2 IDs). The `prestart` script runs `build` and `db:migrate:local` — the migration stub commands from ISSUE-01/03 will echo warnings but not fail.
