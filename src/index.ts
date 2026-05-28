/**
 * Worker entry point for the Video Processing Pipeline.
 *
 * ## What this file does
 *
 * This module wires together the complete HTTP layer of the pipeline:
 *
 * 1. **Request logging** — Every request is assigned a unique `requestId` and
 *    its method, path, response status, and duration are logged as structured JSON.
 *    This runs before auth so every request (including auth redirects) is captured.
 *
 * 2. **Cloudflare Access authentication** — Two middleware functions from
 *    `@adrianhall/cloudflare-auth` protect the API routes:
 *    - `developerAuthentication` — a no-op in production; drives a PIN-style
 *      browser login form in local development so the `CF_Authorization` cookie
 *      is populated before the SPA makes API calls.
 *    - `cloudflareAccess` — validates the Cloudflare Access JWT on every request
 *      whose path matches a policy with `authenticate: true`.
 *
 * 3. **API routes** — The single `videosRouter` mounts all `/api/videos` endpoints.
 *    A public `/api/version` endpoint is available without credentials for health
 *    checks and uptime monitors.
 *
 * 4. **React SPA catch-all** — Every unmatched `GET` request falls through to the
 *    Worker Assets binding (`c.env.ASSETS.fetch()`), which serves the pre-built
 *    React SPA from the `public/` directory.  This enables client-side routing in
 *    the browser — refreshing any deep URL returns `index.html` instead of a 404.
 *
 * ## Middleware registration order
 *
 * Order is non-negotiable.  Swapping any two of the first four `app.use()` calls
 * will break either logging, development auth, or production JWT validation.
 *
 * ```
 * app.use  → logging middleware        (sets requestId, logs after response)
 * app.use  → developerAuthentication   (local dev only: browser login form)
 * app.use  → cloudflareAccess          (production: JWT validation)
 * app.route → /api/videos              (video CRUD, workflow, streaming)
 * app.get  → /api/version              (public health check)
 * app.get  → *                         (SPA catch-all — always last)
 * app.onError → error handler          (requestId-tagged 500 responses)
 * ```
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
import { videosRouter } from "./api/videos";

/**
 * Hono application type that wires the generated `Env` bindings, the
 * authentication context variables from `@adrianhall/cloudflare-auth`, and
 * the per-request `requestId` used for error correlation.
 *
 * Using this type alias keeps the generic parameter out of sight for all
 * sub-routers that import and mount their routes into `app`.
 */
type AppEnv = {
  Bindings: Env;
  Variables: AuthVariables & { requestId?: string };
};

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
 * All `/api/videos` routes are handled by the single `videosRouter` (see
 * `src/api/videos.ts`).  The catch-all at the bottom forwards every unmatched
 * `GET` request to the Worker Assets binding so the React SPA handles
 * client-side routing.
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
// Request logging middleware — MUST be the FIRST app.use() call.
//
// Generates a `requestId` (UUID v4) for every incoming request and stores it
// in the Hono context so that downstream handlers and the error handler can
// reference the same ID.  After the response is produced, logs a structured
// JSON line that includes the request method, path, response status code, and
// wall-clock duration in milliseconds.
//
// Because this middleware runs before auth, it captures every request — auth
// redirects, preflight errors, and successful API calls are all visible in the
// Workers log stream.
// ---------------------------------------------------------------------------
app.use(async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("requestId", requestId);
  const start = Date.now();
  await next();
  console.log(
    JSON.stringify({
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Date.now() - start,
    }),
  );
});

// ---------------------------------------------------------------------------
// Auth middleware — order is NON-NEGOTIABLE.
//
// `developerAuthentication` MUST be registered before `cloudflareAccess`.
// In production `developerAuthentication` is a no-op; in dev it injects the
// `Cf-Access-Jwt-Assertion` header that `cloudflareAccess` then validates.
// Reversing the order causes `cloudflareAccess` to 401 every dev request
// before the login cookie can be set.
//
// Both middleware receive the same `authPolicies` array.  Each policy maps a
// URL pattern to an authentication requirement.  Patterns are evaluated in
// first-match-wins order — see the `authPolicies` declaration above for the
// full policy list and rationale.
// ---------------------------------------------------------------------------
app.use(developerAuthentication({ policies: authPolicies }));
app.use(cloudflareAccess({ policies: authPolicies }));

// ---------------------------------------------------------------------------
// API routes — mounted before the catch-all static asset handler
// ---------------------------------------------------------------------------

/**
 * All `/api/videos` routes: upload initiation, video CRUD, workflow status,
 * and R2 streaming.  Routes are registered in specificity order within
 * `videosRouter` so `/:id/status` and `/:id/stream` are matched before `/:id`.
 *
 * See `src/api/videos.ts` for full documentation of each endpoint.
 */
app.route("/api/videos", videosRouter);

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

// ---------------------------------------------------------------------------
// Global error handler — catches exceptions thrown during request handling.
//
// This fires when a route handler or middleware throws an unhandled error
// (i.e. NOT for explicit `return c.json({ error: ... }, 500)` responses).
// The `requestId` set by the logging middleware is included in the response
// body so operators can correlate the error log line with the access log.
// ---------------------------------------------------------------------------

/**
 * Global Hono error handler.
 *
 * Catches any exception thrown (not returned) by a route handler or middleware
 * and returns a structured JSON error response with a `requestId` for
 * correlation across log streams.
 *
 * @param err - The thrown `Error` (or unknown value) that was not caught
 *   by the route handler itself.
 * @param c - The Hono context at the time the error was thrown.
 * @returns `500 { error: string; requestId: string }` JSON response.
 */
app.onError((err, c) => {
  // Re-use the requestId set by the logging middleware if available; fall back
  // to a fresh UUID if the error occurred before that middleware ran.
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  console.error(
    JSON.stringify({
      requestId,
      error: err instanceof Error ? err.message : String(err),
      method: c.req.method,
      path: c.req.path,
    }),
  );
  return c.json(
    {
      error:
        err instanceof Error ? err.message : "An unexpected error occurred",
      requestId,
    },
    500,
  );
});

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
