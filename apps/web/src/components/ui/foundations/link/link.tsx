"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "../../utils/tailwind/cn";

const linkVariants = cva(
  "flex w-fit flex-row items-center gap-1 font-primary text-sm underline-offset-4 transition-colors duration-150 ease-in-out hover:underline",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "text-foreground",
        muted: "text-muted-foreground hover:text-foreground",
      },
    },
  },
);

export type LinkVariant = NonNullable<
  VariantProps<typeof linkVariants>["variant"]
>;

interface LinkOwnProps extends VariantProps<typeof linkVariants> {
  readonly children?: React.ReactNode;
  readonly className?: string;
  readonly rel?: string;
  readonly target?: React.HTMLAttributeAnchorTarget;
  /**
   * Element/component to render instead of `<a>` (e.g. a router `Link`).
   * Must forward `className`, `ref` and remaining props to a single anchor.
   * @default "a"
   */
  readonly as?: React.ElementType;
}

export type LinkProps<C extends React.ElementType = "a"> = Omit<
  LinkOwnProps,
  "as"
> & {
  readonly as?: C;
} & Omit<React.ComponentPropsWithoutRef<C>, keyof LinkOwnProps>;

/**
 * Root of the compound link. Renders a plain `<a>` — not `next/link` — since
 * this library ships to Vite/Storybook and any consumer, not only Next.js,
 * and `next/link` needs a router context this package can't assume exists.
 * For client-side navigation in a Next.js app, wrap it: `<NextLink href="/x" passHref legacyBehavior><Link>...</Link></NextLink>`.
 */
function LinkRoot<C extends React.ElementType = "a">({
  as,
  children,
  className,
  variant,
  target,
  rel,
  ...props
}: LinkProps<C>) {
  const Component: React.ElementType = as ?? "a";
  return (
    <Component
      className={cn(
        linkVariants({
          variant,
        }),
        className,
      )}
      rel={target === "_blank" ? (rel ?? "noopener noreferrer") : rel}
      target={target}
      {...props}
    >
      {children}
    </Component>
  );
}

export interface LinkTextProps {
  children: React.ReactNode;
  className?: string;
}

/** Label text for a `Link`. */
function LinkText({ children, className }: LinkTextProps) {
  return <span className={cn("font-primary", className)}>{children}</span>;
}

export interface LinkIconProps {
  /** An already-rendered icon element (a Lucide icon, etc.). */
  children: React.ReactNode;
  className?: string;
}

/** Icon slot for a `Link`. Inherits the link's color via `currentColor`. */
function LinkIcon({ children, className }: LinkIconProps) {
  return (
    <span
      className={cn(
        "flex size-4 shrink-0 items-center justify-center [&>svg]:size-4",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Compound link.
 * @example
 * ```tsx
 * <Link href="/settings" variant="muted">
 *   <Link.Icon><Settings /></Link.Icon>
 *   <Link.Text>Settings</Link.Text>
 * </Link>
 * ```
 */
export const Link = Object.assign(LinkRoot, {
  Icon: LinkIcon,
  Text: LinkText,
});
