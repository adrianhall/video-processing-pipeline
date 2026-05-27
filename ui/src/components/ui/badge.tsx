import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Class-variance-authority configuration for the `Badge` component.
 *
 * Exported so callers can compose badge styles outside the `Badge` component
 * itself (e.g. in table cells or custom wrappers).
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/**
 * Compact label component for status indicators, tags, and counts.
 *
 * Renders as a pill-shaped `<span>` (or any element via `asChild`) with six
 * visual variants.  Use `variant="destructive"` for error states,
 * `variant="secondary"` for in-progress states, and `variant="default"` for
 * success states.
 *
 * @param props - All standard `<span>` props plus:
 * @param props.variant - Visual style: `"default"` | `"secondary"` |
 *   `"destructive"` | `"outline"` | `"ghost"` | `"link"`.
 *   Defaults to `"default"`.
 * @param props.asChild - When `true`, merges props onto the immediate child
 *   element instead of rendering a `<span>`.
 * @param props.className - Additional Tailwind classes merged via `cn()`.
 * @returns A styled badge element.
 *
 * @example
 * ```tsx
 * <Badge variant="secondary">Processing</Badge>
 * <Badge variant="destructive">Error</Badge>
 * <Badge variant="default">Done</Badge>
 * ```
 */
function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
