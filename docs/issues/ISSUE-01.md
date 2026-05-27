# Issue 01 — Project Scaffolding

## Summary

Set up the monorepo foundation: root `package.json` with all orchestration scripts, TypeScript project-references root, Biome config, `.env.example`, and the `src/` and `ui/` directory stubs so that `npm run check` passes from this issue onward.

## Relevant Skills

- `cloudflare`
- `cloudflare-scripts`
- `wrangler`
- `workers-best-practices`

## Dependencies

- None (first issue)

## Acceptance Criteria

- [ ] Root `package.json` exists with `name`, `private: true`, and all standard npm scripts wired (see Technical Implementation)
- [ ] `npm-run-all2`, `shx`, `wrangler`, `@adrianhall/cloudflare-scripts`, `typescript`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`, `vitest`, and `@biomejs/biome` are in `devDependencies`
- [ ] `biome.json` exists with recommended rules, formatter enabled, organizeImports enabled
- [ ] Root `tsconfig.json` uses project references pointing to `src/` and `ui/`
- [ ] `src/tsconfig.json` exists as a composite project (`composite: true`, `outDir`, `rootDir`, Workers types)
- [ ] `src/index.ts` exists as a minimal placeholder that exports a default fetch handler returning `new Response("OK")`
- [ ] `.env.example` exists with placeholder keys: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_WORKERS_DOMAIN`, `CLOUDFLARE_TEAM_DOMAIN`
- [ ] `.gitignore` is updated to include `public/`, `wrangler.jsonc`, `.env`, `.wrangler/`, `*.tfstate*`, `**/.terraform/*`, `node_modules/`, `*.tsbuildinfo`, `dist/`
- [ ] `npm run check` passes (types + biome + markdown lint)
- [ ] `npm run fix` runs without error

## Added, Modified, and Deleted Files

| File | Op | Notes |
|------|----|-------|
| `package.json` | Modified | Add all scripts and devDependencies |
| `biome.json` | Added | Shared lint + format config |
| `tsconfig.json` | Added | Project-references root |
| `src/tsconfig.json` | Added | Worker composite project |
| `src/index.ts` | Added | Minimal placeholder Worker |
| `.env.example` | Added | Credential placeholders |
| `.gitignore` | Modified | Add `public/`, remaining entries |

## Technical Implementation

### npm Scripts (root `package.json`)

All scripts use `run-s` from `npm-run-all2` for sequential fail-fast chaining. This is the complete set — some will be no-ops or stubs until later issues wire them up.

```jsonc
{
  "scripts": {
    // Quality
    "check":            "run-s check:*",
    "check:types":      "tsc -b --noEmit",
    "check:biome":      "biome check .",
    "check:markdown":   "markdownlint-cli2 '**/*.md'",
    "fix":              "run-s fix:*",
    "fix:biome":        "biome check --write .",

    // Test
    "test":             "vitest run",
    "test:coverage":    "vitest run --coverage",

    // Build
    "build":            "run-s build:*",
    "build:ui":         "echo 'no ui yet'",

    // Infrastructure
    "preprovision":     "terraform -chdir=infra init",
    "provision":        "terraform -chdir=infra apply -auto-approve",
    "postprovision":    "generate-wrangler -cf -t infra",
    "teardown":         "terraform -chdir=infra destroy -auto-approve",
    "postteardown":     "shx rm -f wrangler.jsonc",

    // Deploy
    "predeploy":        "run-s build db:migrate:remote",
    "deploy":           "wrangler deploy",
    "db:migrate:remote": "echo 'no migrations yet'",
    "db:migrate:local":  "echo 'no migrations yet'",

    // Dev
    "prestart":         "run-s build db:migrate:local",
    "start":            "wrangler dev"
  }
}
```

Stub scripts (`echo '...'`) will be replaced by real commands in their respective issues. The key invariant is that `npm run check`, `npm run build`, `npm start`, `npm run provision`, and `npm run deploy` are all callable from issue 01 onward — they may be partial, but they must not error.

### biome.json

Use recommended rules. Enable formatter with 2-space indent, double quotes. Enable organize imports. Ignore `node_modules/`, `public/`, `infra/`, `.wrangler/`, `container/`.

### TypeScript Config

Root `tsconfig.json` uses `references` only — no `compilerOptions` here. `src/tsconfig.json` targets `ES2022`, module `ESNext`, `moduleResolution: "Bundler"`, includes `@cloudflare/workers-types` in types.

### Placeholder Worker

`src/index.ts` must be a valid Worker entry so that `tsc -b --noEmit` passes:

```typescript
export default {
  async fetch(): Promise<Response> {
    return new Response("OK");
  },
};
```

## Manual Tests

1. Run `npm run check` — all three sub-checks pass with zero errors
2. Run `npm run fix` — completes without error
3. Run `npm run build` — completes without error (stubs echo)

## Other Notes

This issue establishes the "always green" contract: after every issue, `npm run check` must pass. Scripts that depend on infrastructure not yet created use `echo` stubs that will be replaced in later issues.
