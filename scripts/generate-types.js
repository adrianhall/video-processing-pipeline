#!/usr/bin/env node
/**
 * scripts/generate-types.js
 *
 * Ensures src/worker-configuration.d.ts is up to date with wrangler.jsonc
 * by running `wrangler types` only when necessary.
 *
 * Exit codes:
 *   0  — types are already fresh, or wrangler types succeeded
 *   1  — wrangler.jsonc does not exist (need to run `npm run provision`)
 *   *  — wrangler types failed (propagates wrangler's own exit code)
 *
 * Decision table:
 *   wrangler.jsonc missing                 → error + exit 1
 *   worker-configuration.d.ts missing      → run wrangler types
 *   wrangler.jsonc newer than d.ts         → run wrangler types
 *   worker-configuration.d.ts newer        → skip (exit 0)
 */

const { existsSync, statSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const CONFIG = resolve(root, "wrangler.jsonc");
const TYPES = resolve(root, "src", "worker-configuration.d.ts");

// ── 1. wrangler.jsonc must exist ────────────────────────────────────────────
if (!existsSync(CONFIG)) {
  console.error(
    "error: wrangler.jsonc not found.\n" +
      "       Run `npm run provision` to provision infrastructure and generate it.",
  );
  process.exit(1);
}

// ── 2. Decide whether to regenerate types ───────────────────────────────────
const configMtime = statSync(CONFIG).mtimeMs;

if (existsSync(TYPES)) {
  const typesMtime = statSync(TYPES).mtimeMs;
  if (typesMtime > configMtime) {
    // worker-configuration.d.ts is newer than wrangler.jsonc — nothing to do.
    process.exit(0);
  }
  console.log(
    "generate-types: wrangler.jsonc is newer than worker-configuration.d.ts — regenerating...",
  );
} else {
  console.log(
    "generate-types: worker-configuration.d.ts not found — generating...",
  );
}

// ── 3. Run wrangler types ────────────────────────────────────────────────────
// Target src/worker-configuration.d.ts so src/tsconfig.json picks it up.
// --include-runtime (default true): embed the workerd runtime globals alongside
//   the Env interface so @cloudflare/workers-types is not needed as a separate
//   devDependency. This is the Cloudflare-recommended approach.
// --strict-vars=false: emit `string` for var types rather than string literals.
//   With strict-vars=true, wrangler embeds actual token values as literal types
//   (e.g. R2_SECRET_ACCESS_KEY: "cfat_..."). Since wrangler.jsonc and .env are
//   gitignored, the generated file must not contain those values.
// shell: true is required on Windows where npx is a .cmd file, not a binary.
const result = spawnSync(
  "npx",
  ["wrangler", "types", "src/worker-configuration.d.ts", "--strict-vars=false"],
  { stdio: "inherit", shell: true },
);

if (result.error) {
  // spawnSync sets result.error when the binary could not be launched at all
  // (e.g. ENOENT — wrangler not installed).
  console.error(
    "generate-types: failed to launch wrangler:",
    result.error.message,
  );
  process.exit(1);
}

// Propagate wrangler's exit code exactly (null means killed by signal → treat as failure).
process.exit(result.status ?? 1);
