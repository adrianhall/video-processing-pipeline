/**
 * Worker test suite setup — applied before every test file in the `worker`
 * Vitest project via `setupFiles` in `vitest.config.ts`.
 *
 * Applies the D1 migrations to the in-memory SQLite database that miniflare
 * creates for the `DB` binding.
 *
 * ## Why `applyD1Migrations` instead of `readFileSync`
 *
 * Inside miniflare's virtual Workers filesystem, `node:fs readFileSync` with
 * a host-relative path fails — the file isn't in the miniflare bundle.
 * Instead, the migration SQL is read in the vitest config (Node.js context,
 * full host filesystem access) via `readD1Migrations`, injected into the
 * worker project via `provide.migrations`, and consumed here with
 * `inject("migrations")`.
 *
 * `applyD1Migrations` maintains a `d1_migrations` tracking table so it is
 * idempotent across multiple test runs.
 *
 * @module tests/worker/setup
 */

import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { D1Migration } from "@cloudflare/vitest-pool-workers";
import { beforeAll, inject } from "vitest";

/**
 * Seed the miniflare in-memory D1 database with the initial schema migration
 * before any worker tests run.
 *
 * The migration objects are injected from `vitest.config.ts` where
 * `readD1Migrations("./migrations")` reads them in the Node.js context
 * (before miniflare starts).
 */
beforeAll(async () => {
  const migrations = inject("migrations") as D1Migration[];
  await applyD1Migrations(env.DB, migrations);
});
