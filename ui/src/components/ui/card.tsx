import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Top-level card container with optional `size` variant.
 *
 * Renders a rounded, ring-bordered surface that groups related content.
 * Compose with `CardHeader`, `CardContent`, and `CardFooter` for structured
 * layouts, or add arbitrary children directly.
 *
 * @param props - All standard `<div>` props plus:
 * @param props.size - `"default"` (standard padding) or `"sm"` (reduced padding).
 *   Defaults to `"default"`.
 * @param props.className - Additional Tailwind classes merged via `cn()`.
 * @returns A styled card `<div>` element.
 *
 * @example
 * ```tsx
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Upload Videos</CardTitle>
 *   </CardHeader>
 *   <CardContent>…</CardContent>
 * </Card>
 * ```
 */
function Card({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        "group/card flex flex-col gap-4 overflow-hidden rounded-xl bg-card py-4 text-sm text-card-foreground ring-1 ring-foreground/10 has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Header section of a `Card`.
 *
 * Provides a grid layout that accommodates an optional `CardAction` in the
 * top-right corner.  Place `CardTitle` and `CardDescription` inside.
 *
 * @param props - All standard `<div>` props.
 * @returns A styled header `<div>` element.
 */
function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-4 group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Primary title text rendered inside a `CardHeader`.
 *
 * Uses the project's heading font at base size with medium weight.
 *
 * @param props - All standard `<div>` props.
 * @returns A styled title `<div>` element.
 */
function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Secondary description text rendered inside a `CardHeader`, below the title.
 *
 * @param props - All standard `<div>` props.
 * @returns A styled description `<div>` element using `text-muted-foreground`.
 */
function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/**
 * Optional action area positioned in the top-right corner of a `CardHeader`.
 *
 * Use for secondary actions like close buttons, menus, or edit links that sit
 * alongside the card title without pushing it down.
 *
 * @param props - All standard `<div>` props.
 * @returns A styled action `<div>` element.
 */
function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Main body of a `Card`.
 *
 * Provides horizontal padding consistent with the card size variant.
 * Place the primary content of the card here.
 *
 * @param props - All standard `<div>` props.
 * @returns A styled content `<div>` element.
 */
function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-4 group-data-[size=sm]/card:px-3", className)}
      {...props}
    />
  );
}

/**
 * Footer section of a `Card`, displayed with a top border and muted background.
 *
 * Intended for actions, metadata, or summary information shown at the bottom
 * of the card.
 *
 * @param props - All standard `<div>` props.
 * @returns A styled footer `<div>` element.
 */
function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/card:p-3",
        className,
      )}
      {...props}
    />
  );
}

export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
};
