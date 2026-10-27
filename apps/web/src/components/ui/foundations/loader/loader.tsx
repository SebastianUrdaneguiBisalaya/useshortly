"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../utils/tailwind/cn";
import type { IconSize } from "../icon/icon";

const loaderVariants = cva("animate-spin", {
  defaultVariants: {
    variant: "foreground",
  },
  variants: {
    variant: {
      destructive: "text-destructive",
      foreground: "text-foreground",
      inverse: "text-background",
      muted: "text-muted-foreground",
    },
  },
});

const sizeClassName: Record<IconSize, string> = {
  lg: "size-5",
  md: "size-4",
  sm: "size-3.5",
  xl: "size-6",
  xs: "size-3",
};

export type LoaderVariantProps = VariantProps<typeof loaderVariants>["variant"];

export interface LoaderProps extends React.HTMLAttributes<SVGSVGElement> {
  /**
   * Color of the spinner, resolved from a semantic token so it re-colors
   * automatically with the theme.
   * @default "foreground"
   */
  variant?: LoaderVariantProps;
  /**
   * Size of the spinner, matching `Icon`'s size scale.
   * @default "md"
   */
  size?: IconSize;
}

/** Indeterminate loading spinner. Pair with visually hidden text (`aria-label` or `sr-only`) so it announces to assistive tech. */
export function Loader({
  variant = "foreground",
  size = "md",
  className,
  ...props
}: LoaderProps) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={cn(
        loaderVariants({
          variant,
        }),
        sizeClassName[size],
        className,
      )}
      {...props}
    />
  );
}
