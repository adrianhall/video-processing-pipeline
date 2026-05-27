/**
 * Worker entry point for the Video Processing Pipeline.
 *
 * Sets up a Hono application with Cloudflare Access authentication middleware,
 * a public version health-check route, and a catch-all that proxies unmatched
 * requests to the React SPA via the Worker Assets binding.
 *
 * ## Request flow
 * 1. `developerAuthentication` — no-op in production; drives a PIN-style
 *    login form in local development so the `CF_Authorization` cookie is set
 *    before the SPA makes API calls.
 * 2. `cloudflareAccess` — validates the Cloudflare Access JWT for every
 *    path whose policy requires authentication.
 * 3. API routes — mounted under `/api/`.
 * 4. Catch-all `GET *` — forwards to `ASSETS` binding (React SPA).
 *
 * @module
 */

import {
  type AuthVariables,
  cloudflareAccess,
  developerAuthentication,
  type PathPolicy,
} from "@adrianhall/cloudflare-auth";
import { Hono } from "hono";
import { statusRouter } from "./api/status";
import { uploadRouter } from "./api/upload";
import { videosRouter } from "./api/videos";

/**
 * Hono application type that wires the generated `Env` bindings and the
 * authentication context variables from `@adrianhall/cloudflare-auth` into
 * the Hono context type system.
 *
 * Using this type alias keeps the generic parameter out of sight for all
 * sub-routers that import and mount their routes into `app`.
 */
type AppEnv = { Bindings: Env; Variables: AuthVariables };

/**
 * Path-based authentication policies shared by both middleware functions.
 *
 * Policies are evaluated in **first-match-wins** order:
 * - `GET /api/version` is public (health check, no auth required).
 * - All other `/api/` paths require a valid Cloudflare Access JWT.
 * - Paths that match no policy fall through to `cloudflareAccess` with its
 *   default action (`"block"`), so they are rejected unless authenticated.
 *
 * **Do not add `/_auth/*` here** — `developerAuthentication` owns those
 * paths internally.  Adding them to the policies array causes the login
 * form to return 404.
 */
const authPolicies: PathPolicy[] = [
  /**
   * Public health-check — allows anonymous access so load balancers and
   * monitoring tools can ping the Worker without credentials.
   */
  { pattern: /^\/api\/version$/, authenticate: false },
  /**
   * All remaining `/api/` paths require authentication.  This rule must come
   * after any public `/api/` exceptions.
   */
  { pattern: /^\/api\//, authenticate: true },
];

/**
 * Root Hono application.
 *
 * Sub-routers for individual API resource groups (videos, upload, status)
 * will be mounted into this app in later issues.  The catch-all at the
 * bottom forwards every unmatched `GET` request to the Worker Assets binding
 * so the React SPA handles client-side routing.
 *
 * @example
 * ```ts
 * // Test the version endpoint without auth
 * const res = await app.fetch(new Request("http://localhost/api/version"), env);
 * // => 200 { "version": "1.0.0" }
 * ```
 */
const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Auth middleware — order is NON-NEGOTIABLE.
//
// `developerAuthentication` MUST be registered before `cloudflareAccess`.
// In production `developerAuthentication` is a no-op; in dev it injects the
// `Cf-Access-Jwt-Assertion` header that `cloudflareAccess` then validates.
// Reversing the order causes `cloudflareAccess` to 401 every dev request
// before the login cookie can be set.
// ---------------------------------------------------------------------------
app.use(developerAuthentication({ policies: authPolicies }));
app.use(cloudflareAccess({ policies: authPolicies }));

// ---------------------------------------------------------------------------
// API routes — mounted before the catch-all static asset handler
// ---------------------------------------------------------------------------

/**
 * Upload initiation routes: `POST /api/videos` and `POST /api/videos/:id/process`.
 *
 * See `src/api/upload.ts` for full documentation of each endpoint.
 */
app.route("/api/videos", uploadRouter);

/**
 * Video read routes: `GET /api/videos` and `GET /api/videos/:id`.
 *
 * Mounted at the same path prefix as `uploadRouter` — no conflict because
 * all routes in `videosRouter` use `GET` while `uploadRouter` uses `POST`.
 *
 * See `src/api/videos.ts` for full documentation of each endpoint.
 */
app.route("/api/videos", videosRouter);

/**
 * Workflow status route: `GET /api/videos/:id/status`.
 *
 * Returns combined D1 pipeline status and live Cloudflare Workflow instance
 * status for a given video.  Consumed by the frontend polling mechanism to
 * show real-time processing progress.
 *
 * See `src/api/status.ts` for full documentation of the endpoint.
 */
app.route("/api/videos", statusRouter);

// ---------------------------------------------------------------------------
// Public routes
// ---------------------------------------------------------------------------

/**
 * Health-check / version endpoint.
 *
 * Returns the API version string.  No authentication is required (see
 * `authPolicies`).  Useful for smoke tests, uptime monitors, and confirming
 * the correct Worker version is deployed.
 *
 * @returns `200 { "version": "1.0.0" }`
 */
app.get("/api/version", (c) => c.json({ version: "1.0.0" }));

// ---------------------------------------------------------------------------
// Static asset catch-all — MUST be the last route registered.
//
// Forwards every unmatched GET request to the Worker Assets binding
// (`c.env.ASSETS`), which serves the pre-built React SPA.
//
// IMPORTANT: Do NOT use `serveStatic` from `hono/cloudflare-workers` here.
// That helper reads `c.env.__STATIC_CONTENT` — the KV namespace used by the
// legacy Workers Sites system.  With the `assets.binding` wrangler config,
// `__STATIC_CONTENT` is `undefined` and every asset request returns 404.
// ---------------------------------------------------------------------------
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

// ---------------------------------------------------------------------------
// Durable Object / Workflow class exports — required by Wrangler.
//
// Wrangler validates that every class referenced in the `containers`,
// `durable_objects.bindings`, and `workflows` sections of wrangler.jsonc is
// exported from the Worker entry point.  Re-export them here so they are
// visible from this module without duplicating their definitions.
// ---------------------------------------------------------------------------
export { FFmpegContainer } from "./container";
export { VideoProcessingWorkflow } from "./workflow";
