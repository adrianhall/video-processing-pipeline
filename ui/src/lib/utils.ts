import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges Tailwind CSS class names with conflict resolution.
 *
 * Combines `clsx` (conditional class application) with `tailwind-merge`
 * (Tailwind-aware deduplication) so that later class names always win over
 * earlier ones for the same CSS property.
 *
 * @param inputs - Any number of class values: strings, arrays, or conditional
 *   objects accepted by `clsx`.
 * @returns A single merged class string safe to pass to `className`.
 *
 * @example
 * ```ts
 * cn("px-4 py-2", isActive && "bg-primary", "px-6")
 * // → "py-2 bg-primary px-6"  ("px-4" is overridden by the later "px-6")
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
