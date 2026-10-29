"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../utils/tailwind/cn";

const iconVariants = cva("shrink-0", {
  defaultVariants: {
    size: "md",
  },
  variants: {
    size: {
      lg: "w-5 h-5",
      md: "w-4 h-4",
      sm: "w-3.5 h-3.5",
      xl: "w-6 h-6",
      xs: "w-3 h-3",
    },
  },
});

export type IconSize = NonNullable<VariantProps<typeof iconVariants>["size"]>;

export interface IconProps
  extends Omit<React.ComponentProps<LucideIcon>, "size">,
    VariantProps<typeof iconVariants> {
  /** Lucide icon component to render. */
  icon: LucideIcon;
  /**
   * Size of the icon.
   * @default "md"
   */
  size?: IconSize;
}

/** Renders a Lucide icon at one of the design system's fixed sizes. */
export function Icon({
  icon: LucideIconComponent,
  className,
  size,
  ...props
}: IconProps) {
  return (
    <LucideIconComponent
      className={cn(
        iconVariants({
          size,
        }),
        className,
      )}
      {...props}
    />
  );
}
