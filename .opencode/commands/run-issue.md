---
description: "Implement a project issue: create branch, write code with JSDoc, check, test, commit"
agent: build
---

# Project ISSUE Execution Command

## Current repository state

!`git status --short 2>&1`

Current branch: !`git branch --show-current 2>&1`

If you are not on the `main` branch, **STOP** and inform the human user that the pre-conditions for starting the issue are not met (explicitly that you may not have merged the previous issue).

---

## Issue to implement

Read `docs/issues/ISSUE-$1.md`

---

## Project MVP plan (for architectural context)

Read `docs/PLAN.md`

## Decisions Log

Read `docs/DECISIONS.md` if it exists for information on previous variances to the plan.

---

## Instructions

You are implementing **issue #$1** for this project. Follow these steps **in order**, using the TodoWrite tool to track your progress.

---

### Step 1 — Create the branch

Run:

```bash
git checkout -b issues/$1
```

If the branch already exists, run `git checkout issues/$1` instead.

Confirm you are on `issues/$1` before writing any code.

---

### Step 2 — Plan the work

Re-read the issue above carefully. Use the TodoWrite tool to break the acceptance criteria into individual, checkable tasks before writing a single line of code. Work through them one at a time; mark each `completed` as soon as it is done.

---

### Step 2b — Load skills

Load all skills listed in `docs/SKILLS.md` to start.

Then check the issue for a **## Relevant Skills** section. If one is present, load every skill listed there as well. Those skills contain rules that are specific to the patterns used in this issue — particularly around Cloudflare infrastructure provisioning and Access-based authentication — where deviating from the documented approach produces bugs that are difficult to diagnose.

Review the skills available to you and load any other useful skills specific to the issue you are implementing.

---

### Step 3 — Implement

Write the code exactly as described in the issue. Honour every acceptance criterion.

**File and module placement** must match the paths specified in the issue and in the project structure section of `PLAN.md`. Do not invent new locations.

Run `npm install` (and `npm --prefix ./ui install` if `ui/package.json` was modified) to ensure new dependencies are available.

---

### Step 4 — JSDoc (mandatory — no exceptions)

Every TypeScript file you create or modify must meet these documentation standards.

**Exported symbols**:

Every exported `function`, `class`, `interface`, `type` alias, and `enum` **must** have a JSDoc block. Required tags:

- A leading prose description (one sentence minimum; more when the behaviour is subtle).
- `@param <name>` — one tag per parameter, with a description. Omit only for parameters whose name and type make the meaning completely unambiguous (rare).
- `@returns` — required for every non-`void` return; describe what is returned and any notable edge cases (`undefined`, empty array, …).
- `@example` — include when the call signature alone does not make usage obvious, or when there is an important gotcha.

**React / JSX components**:

Every component function (exported or not, if it renders JSX) **must** have a JSDoc block that includes:

- A prose description of what the component renders and when to use it.
- A `@param props` entry (or individual `@param` entries for each prop if they are destructured).
- A `@example` showing realistic JSX usage, including any required context providers or sibling elements.

**Internal helpers**:

Non-exported functions that are longer than ~5 lines or whose purpose is not obvious from their name must have at least a one-line JSDoc description.

**What to avoid**:

- Do not write JSDoc that merely restates the type signature (`@param id - string`). Add information the reader cannot already see.
- Do not leave any exported symbol undocumented. If `npm run check:types` or Biome reports a problem, fix it.

---

### Step 5 — Verify: check

Run the full quality check suite:

```bash
npm run fix && npm run check
```

This runs all the format fixing scripts, then `check:types` (TypeScript), `check:biome` (lint + format), and `check:infra` (Terraform validate) sequentially. **All three must pass with zero errors or warnings.**

If `check:infra` fails with "providers not initialized", run:

```bash
npm run preprovision
```

then re-run `npm run check`.

Fix every reported issue before moving on. Do not proceed with failing checks.

Run `npm run build` to verify that everything builds correctly.  Identify any warnings that are emitted and determine if they are important enough to consider now or as a follow-up.  Our experience indicates that warnings will be problematic in the future, so they should be considered carefully.

---

### Step 6 — Verify: tests (if applicable)

Skip this step if no test suite exists yet for this layer (check before running).

If the issue adds or modifies **worker API code** (routes, middleware, db, lib), also run:

```bash
npm test
```

Every test must pass. Fix failures before committing.

If the issue is purely frontend, infrastructure, or documentation work and no test suite exists yet for that layer, skip this step and note it in the commit message.

---

### Step 7 - Determine follow-up items

Determine if any follow-up items are needed.  Explicitly, you should determine if any issue documents (stored in `docs/issues`) or the `docs/PLAN.md` document needs to be updated based on what you found while implementing this issue.

- Make changes to `docs/PLAN.md` as needed.
- Add decisions to `docs/DECISIONS.md` (include the issue where the decision was made) - do not include decisions already made in ISSUES documents.
- Add follow-up issues to `docs/issues` using the `docs/EXAMPLE-ISSUE.md` document as a template.

---

### Step 8 — Commit

Stage all changes and create a **single** conventional commit:

```text
<type>(issue-$1): <short description>

<optional body: bullet list of what was implemented>
```

Rules:

- **type**: `feat` for new functionality, `fix` for bug fixes, `chore` for
  scaffolding / config / tooling, `test` for tests-only, `docs` for docs-only,
  `refactor` for refactoring without behaviour change.
- **scope**: `issue-$1` (e.g. `issue-01`).
- **short description**: imperative mood, ≤72 characters, no trailing period.
- **body** (optional but encouraged): brief bullet list of the main things added.

Example:

```text
feat(issue-01): project structure, workspaces, and quality scripts

- Root npm workspaces with src/worker and src/frontend
- Biome config with recommended rules
- TypeScript project references
- check/fix scripts using npm-run-all2 run-s
```

Run:

```bash
git add -A
git commit -m "<your message>"
```

**Do not push the branch.** The human will review and merge via pull request.

---

### Done

Once the commit succeeds, report back with:

1. The branch name.
2. The commit hash and message.
3. A brief summary of what was implemented
4. Any decisions you made that deviated from or extended the issue spec (with justification).  These will be logged in `docs/DECISIONS.md`.
5. Any follow-up items discovered during implementation that should be tracked as
   future work, together with their issue file links.
6. One or more (up to six) simple "smoke tests" that the user can perform to determine if the code you have written is working.  This may include checking a dashboard, opening a URL, running a curl command, or similar.  These are listed in the issue document under `Manual Tests`, but you may discover additional ones during development.
7. **IMPORTANT**: If the code cannot be deployed and run, then tell the operator and also inform them when (i.e. after which issue) they will next be able to test the code.
