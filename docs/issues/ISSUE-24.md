# Issue 24 — Test Infrastructure and Tests

## Summary

Set up Vitest with `@cloudflare/vitest-pool-workers` and write tests for the API routes and auth middleware. Tests use `signDevJwt()` from `cloudflare-auth` for authenticated requests.

## Relevant Skills

- `cloudflare-auth`
- `workers-best-practices`
- `wrangler`
- `webapp-testing`

## Dependencies

- ISSUE-05 (Hono API with auth middleware)
- ISSUE-14 (Workflow scaffold — needed for the Workflow binding to exist)

## Acceptance Criteria

- [ ] `vitest.config.ts` exists at the project root using `defineWorkersConfig` with the wrangler config path
- [ ] `@cloudflare/vitest-pool-workers` and `vitest` are in `devDependencies` (if not already from ISSUE-01)
- [ ] `test` script runs `vitest run`; `test:coverage` script runs `vitest run --coverage`
- [ ] At least one test file exists: `src/__tests__/api.test.ts`
- [ ] Tests cover: public `/api/version` returns 200 without auth; protected `/api/videos` returns 302 (redirect to login) without auth; protected route with `signDevJwt` returns 200
- [ ] Tests use `signDevJwt()` and `JWT_HEADER` from `@adrianhall/cloudflare-auth` for authenticated requests
- [ ] `npm test` passes with all tests green
- [ ] `npm run check` passes

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `vitest.config.ts` | Added | Vitest pool workers configuration |
| `src/__tests__/api.test.ts` | Added | API route tests with auth |
| `package.json` | Modified | Ensure `test` and `test:coverage` scripts are correct |

## Technical Implementation

### Vitest Configuration

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

Note: This requires `wrangler.jsonc` to exist. For tests to run without provisioning, a minimal local wrangler config must be available. The `db:migrate:local` pre-script ensures the local D1 has the schema.

### Test Pattern with signDevJwt

```typescript
import { describe, it, expect } from "vitest";
import { signDevJwt, JWT_HEADER } from "@adrianhall/cloudflare-auth";

describe("API", () => {
  it("GET /api/version is public", async () => {
    const res = await fetch("http://localhost/api/version");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe("1.0.0");
  });

  it("GET /api/videos requires auth", async () => {
    const res = await fetch("http://localhost/api/videos", { redirect: "manual" });
    expect(res.status).toBe(302);
  });

  it("GET /api/videos returns 200 with valid token", async () => {
    const token = await signDevJwt("test@example.com");
    const res = await fetch("http://localhost/api/videos", {
      headers: { [JWT_HEADER]: token },
    });
    expect(res.status).toBe(200);
  });
});
```

### Test Script

Ensure the `test` script in `package.json` is `vitest run` (not `vitest` which starts watch mode). The `test:coverage` script should be `vitest run --coverage`.

## Manual Tests

1. Run `npm test` — all tests pass
2. Run `npm run check` — passes
3. Inspect test output — see individual test names and pass/fail status

## Other Notes

The pool-workers test runner executes tests inside the Workers runtime with local simulation of D1, R2, etc. This means tests can interact with real bindings. The D1 migrations must be applied locally first — the `prestart`/`pretest` chain should handle this. If `vitest.config.ts` needs a `pretest` script to run migrations, add `"pretest": "npm run db:migrate:local"` to `package.json`.
