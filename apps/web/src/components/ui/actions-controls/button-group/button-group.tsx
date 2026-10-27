"use client";

import type * as React from "react";

import { cn } from "../../utils/tailwind/cn";

export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Stack direction.
   * @default "horizontal"
   */
  orientation?: "horizontal" | "vertical";
}

/**
 * Groups adjacent `Button`s (or any button-like control sized like one) into
 * a single connected, segmented control: touching borders merge into one
 * hairline and only the outermost corners stay rounded — the shadcn/ui
 * ButtonGroup pattern (https://www.shadcnblocks.com/components/button-group).
 * `role="group"` communicates the cluster to assistive tech; give it an
 * `aria-label` when the buttons' own labels don't make its purpose clear.
 * @example
 * ```tsx
 * <ButtonGroup aria-label="View">
 *   <Button variant="secondary"><Button.Text>Day</Button.Text></Button>
 *   <Button variant="secondary"><Button.Text>Week</Button.Text></Button>
 *   <Button variant="secondary"><Button.Text>Month</Button.Text></Button>
 * </ButtonGroup>
 * ```
 */
function ButtonGroupRoot({
  orientation = "horizontal",
  className,
  ...props
}: ButtonGroupProps) {
  return (
    <div
      className={cn(
        "flex w-fit",
        orientation === "horizontal"
          ? "flex-row *:not-first:-ml-px *:not-first:rounded-l-none *:not-last:rounded-r-none"
          : "flex-col *:not-first:-mt-px *:not-first:rounded-t-none *:not-last:rounded-b-none",
        "*:relative *:focus-visible:z-10",
        className,
      )}
      role="group"
      {...props}
    />
  );
}

export interface ButtonGroupSeparatorProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Matches the group's own orientation — a vertical bar inside a horizontal
   * group, a horizontal bar inside a vertical one.
   * @default "vertical"
   */
  orientation?: "horizontal" | "vertical";
}

/** Thin visual divider between two segments of a `ButtonGroup` (e.g. a non-clickable label sitting between two button clusters). */
function ButtonGroupSeparator({
  orientation = "vertical",
  className,
  ...props
}: ButtonGroupSeparatorProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "shrink-0 self-stretch bg-border",
        orientation === "vertical" ? "w-px" : "h-px w-full",
        className,
      )}
      {...props}
    />
  );
}

export const ButtonGroup = Object.assign(ButtonGroupRoot, {
  Separator: ButtonGroupSeparator,
});
