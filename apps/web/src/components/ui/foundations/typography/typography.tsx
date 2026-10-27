"use client";

import type * as React from "react";

import { cn } from "../../utils/tailwind/cn";

/**
 * Compound typography scale — each piece renders the correct semantic HTML
 * element (`h1`-`h4`, `p`, `blockquote`, `ul`, `code`, `small`) rather than a
 * styled `<span>`/`<div>`, so document structure and copy/paste both stay
 * correct. There's no single "root" element (unlike `Button`/`Badge`), so
 * this is a flat namespace, matching `Modal`/`Select`/`Tabs`.
 */

export interface TypographyH1Props
  extends React.HTMLAttributes<HTMLHeadingElement> {}

/** Page-level heading. */
function H1({ className, ...props }: TypographyH1Props) {
  return (
    <h1
      className={cn(
        "scroll-m-20 text-4xl font-extrabold font-primary tracking-tight text-foreground lg:text-5xl",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographyH2Props
  extends React.HTMLAttributes<HTMLHeadingElement> {}

/** Section heading. */
function H2({ className, ...props }: TypographyH2Props) {
  return (
    <h2
      className={cn(
        "scroll-m-20 border-b border-border pb-2 text-3xl font-semibold font-primary tracking-tight text-foreground first:mt-0",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographyH3Props
  extends React.HTMLAttributes<HTMLHeadingElement> {}

/** Subsection heading. */
function H3({ className, ...props }: TypographyH3Props) {
  return (
    <h3
      className={cn(
        "scroll-m-20 text-2xl font-semibold font-primary tracking-tight text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographyH4Props
  extends React.HTMLAttributes<HTMLHeadingElement> {}

/** Minor heading. */
function H4({ className, ...props }: TypographyH4Props) {
  return (
    <h4
      className={cn(
        "scroll-m-20 text-xl font-semibold font-primary tracking-tight text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographyPProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

/** Body paragraph. */
function P({ className, ...props }: TypographyPProps) {
  return (
    <p
      className={cn(
        "font-primary text-foreground leading-7 not-first:mt-6",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographyLeadProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

/** Larger intro paragraph, e.g. below an `H1`. */
function Lead({ className, ...props }: TypographyLeadProps) {
  return (
    <p
      className={cn("font-primary text-xl text-muted-foreground", className)}
      {...props}
    />
  );
}

export interface TypographyLargeProps
  extends React.HTMLAttributes<HTMLDivElement> {}

/** Emphasized inline block, e.g. a price or a form section label. */
function Large({ className, ...props }: TypographyLargeProps) {
  return (
    <div
      className={cn(
        "font-primary text-lg font-semibold text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographySmallProps
  extends React.HTMLAttributes<HTMLElement> {}

/** Fine print. Renders `<small>`, the correct element for side comments/legal text. */
function Small({ className, ...props }: TypographySmallProps) {
  return (
    <small
      className={cn(
        "font-primary text-sm font-medium leading-none text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographyMutedProps
  extends React.HTMLAttributes<HTMLParagraphElement> {}

/** De-emphasized supporting text. */
function Muted({ className, ...props }: TypographyMutedProps) {
  return (
    <p
      className={cn("font-primary text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export interface TypographyBlockquoteProps
  extends React.BlockquoteHTMLAttributes<HTMLQuoteElement> {}

/** Quoted content. */
function Blockquote({ className, ...props }: TypographyBlockquoteProps) {
  return (
    <blockquote
      className={cn(
        "border-l-2 border-border pl-6 font-primary italic text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographyListProps
  extends React.HTMLAttributes<HTMLUListElement> {}

/** Bulleted list. Children should be `<li>` elements. */
function List({ className, ...props }: TypographyListProps) {
  return (
    <ul
      className={cn(
        "my-6 ml-6 list-disc font-primary text-foreground [&>li]:mt-2",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographyInlineCodeProps
  extends React.HTMLAttributes<HTMLElement> {}

/** Inline code snippet — the one deliberate use of `font-secondary` (monospace) in this library's prose. */
function InlineCode({ className, ...props }: TypographyInlineCodeProps) {
  return (
    <code
      className={cn(
        "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-secondary text-sm font-semibold text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface TypographySpanProps
  extends React.HTMLAttributes<HTMLSpanElement> {}

/** Inline fine print. Renders `<span>`. */
function Span({ className, ...props }: TypographySpanProps) {
  return (
    <span
      className={cn("font-primary text-xs text-foreground", className)}
      {...props}
    />
  );
}

export const Typography = {
  Blockquote,
  H1,
  H2,
  H3,
  H4,
  InlineCode,
  Large,
  Lead,
  List,
  Muted,
  P,
  Small,
  Span,
};
