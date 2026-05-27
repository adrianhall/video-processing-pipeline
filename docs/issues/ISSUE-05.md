# Issue 05 — Hono API with cloudflare-auth

## Summary

Create the Worker entry point using Hono with `cloudflare-auth` middleware for authentication. This establishes the API skeleton: auth middleware, a public `/api/version` health check, and the static asset catch-all. All subsequent API routes (ISSUE-07 through ISSUE-10) mount into this app.

## Relevant Skills

- `cloudflare-auth`
- `workers-best-practices`
- `wrangler`
- `cloudflare`

## Dependencies

- ISSUE-01 (project scaffolding)
- ISSUE-03 (wrangler template with `assets` block configuration)

## Acceptance Criteria

- [ ] `hono` and `@adrianhall/cloudflare-auth` are installed as dependencies
- [ ] `src/types.ts` exists with the `VideoStatus` union type, `VideoWorkflowParams` interface, `ApiSuccess<T>`, `ApiError`, `VideoResource`, and `UploadInitResponse` types from PLAN.md's API Response Envelope section
- [ ] `src/index.ts` creates a Hono app typed with `{ Bindings: Env; Variables: AuthVariables }`
- [ ] Auth policies array is defined: `/api/version` is public, all other `/api/` routes require auth
- [ ] `developerAuthentication` is registered **before** `cloudflareAccess` — both sharing the same policies array
- [ ] `GET /api/version` returns `{ version: "1.0.0" }` with no auth required
- [ ] Catch-all `GET *` route uses `c.env.ASSETS.fetch(c.req.raw)` (not `serveStatic`)
- [ ] `/_auth/*` is **not** included in the policies array
- [ ] `src/index.ts` exports the Hono app as the default export
- [ ] Run `wrangler types` to generate the `Env` type from wrangler config (or create a manual `.d.ts` stub if no `wrangler.jsonc` exists yet)
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `src/index.ts` | Modified | Replace placeholder with Hono app, auth middleware, version route, catch-all |
| `src/types.ts` | Added | Shared TypeScript types: VideoStatus, VideoResource, params, response envelope |
| `package.json` | Modified | Add `hono` and `@adrianhall/cloudflare-auth` dependencies |

## Technical Implementation

### Middleware Order (Non-Negotiable)

```typescript
app.use(developerAuthentication({ policies: authPolicies }));
app.use(cloudflareAccess({ policies: authPolicies }));
```

If reversed, `cloudflareAccess` sees no JWT in dev and returns 401 before `developerAuthentication` can inject headers.

### Policies Array

```typescript
const authPolicies: PathPolicy[] = [
  { pattern: /^\/api\/version$/, authenticate: false },
  { pattern: /^\/api\//, authenticate: true },
];
```

Do NOT add `/_auth/*` — `developerAuthentication` owns those paths internally. Adding them to policies causes 404 on the login form.

### Static Asset Catch-All

```typescript
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));
```

Do NOT use `serveStatic` from `hono/cloudflare-workers` — it reads `__STATIC_CONTENT` which is `undefined` with the `assets.binding` config.

### Env Type

If `wrangler.jsonc` doesn't exist yet (pre-provisioning), create a `src/worker-configuration.d.ts` stub declaring the `Env` interface with all expected bindings. This file is overwritten by `wrangler types` once `wrangler.jsonc` exists. The Env type should include: `DB: D1Database`, `BUCKET: R2Bucket`, `ASSETS: Fetcher`, `VIDEO_WORKFLOW: Workflow`, `FFMPEG_CONTAINER: DurableObjectNamespace`, plus the five vars from PLAN.md (`CLOUDFLARE_TEAM_DOMAIN`, `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_API_TOKEN`). All five are vars (not secrets) — the API tokens are Terraform-managed and injected via `generate-wrangler` for this demo.

## Manual Tests

1. Run `npm run check` — all checks pass
2. Inspect `src/index.ts` — `developerAuthentication` is registered before `cloudflareAccess`
3. Inspect `src/index.ts` — catch-all uses `c.env.ASSETS.fetch(c.req.raw)`, not `serveStatic`

## Other Notes

The app cannot be run locally until ISSUE-06 (static assets) and ISSUE-19 (UI build) provide content for the ASSETS binding. `npm start` will succeed after ISSUE-06 is complete (serving a placeholder page).
