/**
 * Prints a signed developer JWT to stdout.
 *
 * The JWT is minted with `signDevJwt()` from `@adrianhall/cloudflare-auth` using
 * the well-known local-development HMAC secret.  The `developerAuthentication`
 * middleware accepts this token when the Worker is running under `wrangler dev`,
 * making it possible to authenticate API requests from shell scripts without going
 * through the browser PIN flow.
 *
 * ## Usage
 *
 * Run this script and capture its output:
 *
 * ```bash
 * TOKEN=$(npx tsx scripts/get-dev-token.ts)
 * curl -H "cf-access-jwt-assertion: $TOKEN" http://localhost:8787/api/videos
 * ```
 *
 * Or use the companion smoke-test script which handles token acquisition automatically:
 *
 * ```bash
 * bash scripts/smoke-test.sh
 * ```
 *
 * ## Security note
 *
 * The dev JWT is signed with a hard-coded secret that is only valid against the
 * `developerAuthentication` middleware — it does NOT work against real Cloudflare
 * Access in production.  Never use this token outside of a local dev environment.
 *
 * @module get-dev-token
 */

import { signDevJwt } from "@adrianhall/cloudflare-auth";

// Mint a short-lived JWT for the smoke-test identity and print it to stdout.
// The token is captured by callers via: TOKEN=$(npx tsx scripts/get-dev-token.ts)
console.log(await signDevJwt("smoke@example.com"));
