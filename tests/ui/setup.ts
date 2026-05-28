/**
 * UI test suite setup — applied before every test file in the `ui`
 * Vitest project via `setupFiles` in `vitest.config.ts`.
 *
 * 1. Registers `@testing-library/jest-dom` matchers on vitest's `expect` so
 *    DOM assertions (`toBeInTheDocument`, `toBeDisabled`, …) work in every
 *    `tests/ui/**` test file without an explicit import.
 *
 * 2. Registers an `afterEach` cleanup hook so React Testing Library removes
 *    rendered components from the jsdom document after every test.  Without
 *    this, rendered components accumulate across tests in the same file because
 *    vitest does NOT put `afterEach` in global scope (unlike Jest with
 *    `globals: true`), so RTL's automatic cleanup — which checks
 *    `globalThis.afterEach` — never runs.  Multiple renders accumulate and
 *    `getByText` / `getByRole` fail with "Found multiple elements" errors.
 *
 * @module tests/ui/setup
 */

// The `/vitest` subpath registers jest-dom matchers on vitest's `expect`
// without needing `globals: true` in vitest.config.ts.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
