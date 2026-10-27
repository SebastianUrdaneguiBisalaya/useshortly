"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { Icon } from "../../foundations/icon/icon";
import { cn } from "../../utils/tailwind/cn";

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium font-primary transition-colors duration-150 ease-in-out",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "border-transparent bg-muted text-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
        success: "border-transparent bg-success text-success-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
      },
    },
  },
);

export type BadgeVariantProps = VariantProps<typeof badgeVariants>["variant"];

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * Visual style of the badge.
   * @default "default"
   */
  variant?: BadgeVariantProps;
}

export interface BadgeIconProps {
  /** Lucide icon component to render. */
  icon: LucideIcon;
  className?: string;
  /** Accessible name; omit for a purely decorative icon. */
  "aria-label"?: string;
}

export interface BadgeTextProps extends React.HTMLAttributes<HTMLSpanElement> {}

/** Root badge element. Renders a `<span>`, since a badge is a label, not an interactive control. */
function BadgeRoot({ variant = "default", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        badgeVariants({
          variant,
        }),
        className,
      )}
      {...props}
    />
  );
}

/** Icon slot for a `Badge`. Inherits the badge's text color via `currentColor`. */
function BadgeIcon({
  icon,
  className,
  "aria-label": ariaLabel,
}: BadgeIconProps) {
  return (
    <Icon
      aria-hidden={!ariaLabel}
      aria-label={ariaLabel}
      className={cn("shrink-0", className)}
      icon={icon}
      size="xs"
    />
  );
}

/** Label text for a `Badge`. */
function BadgeText({ className, ...props }: BadgeTextProps) {
  return (
    <span
      className={cn("truncate", className)}
      {...props}
    />
  );
}

/**
 * Compound badge.
 * @example
 * ```tsx
 * <Badge variant="success">
 *   <Badge.Icon icon={Check} />
 *   <Badge.Text>Active</Badge.Text>
 * </Badge>
 * ```
 */
export const Badge = Object.assign(BadgeRoot, {
  Icon: BadgeIcon,
  Text: BadgeText,
});
