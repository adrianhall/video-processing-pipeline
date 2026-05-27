import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Accessible horizontal progress bar backed by the Radix UI `Progress`
 * primitive.
 *
 * Displays a filled indicator that transitions smoothly as the `value` prop
 * changes.  Suitable for upload progress, multi-step forms, or any numeric
 * completion percentage.
 *
 * @param props - All props accepted by `ProgressPrimitive.Root` (Radix UI),
 *   most importantly:
 * @param props.value - Completion percentage in the range [0, 100].  Defaults
 *   to `0` when omitted.
 * @param props.className - Additional Tailwind classes merged via `cn()`.
 * @returns A styled progress bar element with an animated fill indicator.
 *
 * @example
 * ```tsx
 * // Show upload progress while a file is being transmitted.
 * <Progress value={uploadPercent} />
 *
 * // Fixed height override
 * <Progress value={50} className="h-2" />
 * ```
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
