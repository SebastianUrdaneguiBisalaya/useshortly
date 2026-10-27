"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "../../utils/tailwind/cn";

/**
 * Gap classes for every `Layout` primitive that arranges children (`Stack`, `HStack`, `Grid`), one entry per
 * breakpoint. Every class is written out in full on purpose: Tailwind generates CSS only for class names it can
 * read as literal strings in the source, so a class assembled at runtime from a breakpoint and a gap would silently produce no
 * `md:gap-4` rule. Adding a size or breakpoint means adding its literals here.
 */
const gapVariants = {
  lg: {
    "2xl": "2xl:gap-6",
    base: "gap-6",
    lg: "lg:gap-6",
    md: "md:gap-6",
    sm: "sm:gap-6",
    xl: "xl:gap-6",
  },
  md: {
    "2xl": "2xl:gap-4",
    base: "gap-4",
    lg: "lg:gap-4",
    md: "md:gap-4",
    sm: "sm:gap-4",
    xl: "xl:gap-4",
  },
  none: {
    "2xl": "2xl:gap-0",
    base: "gap-0",
    lg: "lg:gap-0",
    md: "md:gap-0",
    sm: "sm:gap-0",
    xl: "xl:gap-0",
  },
  sm: {
    "2xl": "2xl:gap-2",
    base: "gap-2",
    lg: "lg:gap-2",
    md: "md:gap-2",
    sm: "sm:gap-2",
    xl: "xl:gap-2",
  },
  xl: {
    "2xl": "2xl:gap-8",
    base: "gap-8",
    lg: "lg:gap-8",
    md: "md:gap-8",
    sm: "sm:gap-8",
    xl: "xl:gap-8",
  },
  xs: {
    "2xl": "2xl:gap-1",
    base: "gap-1",
    lg: "lg:gap-1",
    md: "md:gap-1",
    sm: "sm:gap-1",
    xl: "xl:gap-1",
  },
} as const;

export type LayoutGap = keyof typeof gapVariants;

/** Tailwind breakpoints `Layout` primitives can vary a prop across, matching this project's default breakpoint scale. */
export type LayoutBreakpoint = "sm" | "md" | "lg" | "xl" | "2xl";

/** A prop that's either one fixed value, or a per-breakpoint map (`base` for below the smallest breakpoint) — the `Layout` primitives' responsive-prop shape. */
export type LayoutResponsive<T extends string | number> =
  | T
  | Partial<Record<"base" | LayoutBreakpoint, T>>;

/**
 * Resolves a `LayoutResponsive` prop to a className by looking each value up in a table of literal classes
 * (`gapVariants`, `gridColsVariants`) — never by concatenating a breakpoint prefix onto a class at runtime,
 * which Tailwind's scanner can't see.
 */
function resolveResponsive<T extends string | number>(
  value: LayoutResponsive<T> | undefined,
  table: Record<T, Record<"base" | LayoutBreakpoint, string>>,
): string {
  if (value === undefined) return "";
  if (typeof value !== "object") return table[value].base;

  return Object.entries(value)
    .map(([breakpoint, breakpointValue]) =>
      breakpointValue === undefined
        ? ""
        : (table[breakpointValue as T]?.[
            breakpoint as "base" | LayoutBreakpoint
          ] ?? ""),
    )
    .join(" ");
}

const containerVariants = cva("mx-auto w-full px-4 sm:px-6 lg:px-8", {
  defaultVariants: {
    size: "xl",
  },
  variants: {
    /** Max-width the content is capped at, once the viewport is wider than it. */
    size: {
      full: "max-w-none",
      lg: "max-w-6xl",
      md: "max-w-4xl",
      sm: "max-w-3xl",
      xl: "max-w-7xl",
    },
  },
});

export type LayoutContainerVariantProps = VariantProps<
  typeof containerVariants
>["size"];

export interface LayoutContainerProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Max-width the content is capped at, with responsive horizontal padding
   * at every size.
   * @default "xl"
   */
  size?: LayoutContainerVariantProps;
}

/**
 * Centers content horizontally and caps it at `size`, with responsive side
 * padding — the standard page-width wrapper most layouts start from.
 * @example
 * ```tsx
 * <Layout.Container size="lg">
 *   <Layout.Section>...</Layout.Section>
 * </Layout.Container>
 * ```
 */
function LayoutContainer({ size, className, ...props }: LayoutContainerProps) {
  return (
    <div
      className={cn(
        containerVariants({
          size,
        }),
        className,
      )}
      {...props}
    />
  );
}

const stackVariants = cva("flex flex-col", {
  defaultVariants: {
    align: "stretch",
    justify: "start",
  },
  variants: {
    /** Cross-axis (horizontal) alignment of children. */
    align: {
      center: "items-center",
      end: "items-end",
      start: "items-start",
      stretch: "items-stretch",
    },
    /** Main-axis (vertical) distribution of children. */
    justify: {
      around: "justify-around",
      between: "justify-between",
      center: "justify-center",
      end: "justify-end",
      evenly: "justify-evenly",
      start: "justify-start",
    },
  },
});

export type LayoutStackAlignProps = VariantProps<typeof stackVariants>["align"];
export type LayoutStackJustifyProps = VariantProps<
  typeof stackVariants
>["justify"];

export interface LayoutStackProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Cross-axis (horizontal) alignment of children.
   * @default "stretch"
   */
  align?: LayoutStackAlignProps;
  /**
   * Main-axis (vertical) distribution of children.
   * @default "start"
   */
  justify?: LayoutStackJustifyProps;
  /**
   * Space between children, from the shared `Layout` gap scale. Pass a
   * per-breakpoint map (e.g. `{ base: "sm", lg: "lg" }`) for a gap that
   * grows on larger screens.
   * @default "md"
   */
  gap?: LayoutResponsive<LayoutGap>;
}

/**
 * Vertical flex stack — children laid out top to bottom with a consistent
 * `gap`, instead of ad hoc `flex flex-col gap-*` repeated everywhere. See
 * `Layout.HStack` for the horizontal counterpart.
 * @example
 * ```tsx
 * <Layout.Stack gap={{ base: "sm", lg: "lg" }}>
 *   <h2>Title</h2>
 *   <p>Body copy.</p>
 * </Layout.Stack>
 * ```
 */
function LayoutStack({
  align,
  justify,
  gap = "md",
  className,
  ...props
}: LayoutStackProps) {
  return (
    <div
      className={cn(
        stackVariants({
          align,
          justify,
        }),
        resolveResponsive(gap, gapVariants),
        className,
      )}
      {...props}
    />
  );
}

/** `flex-col` that becomes `flex-row` at each breakpoint, written out in full for the same reason as `gapVariants`. */
const collapseVariants = {
  "2xl": "flex-col 2xl:flex-row",
  lg: "flex-col lg:flex-row",
  md: "flex-col md:flex-row",
  sm: "flex-col sm:flex-row",
  xl: "flex-col xl:flex-row",
} as const;

const hstackVariants = cva("flex", {
  defaultVariants: {
    align: "center",
    justify: "start",
    wrap: false,
  },
  variants: {
    /** Cross-axis (vertical, or horizontal while `collapseBelow` stacks it) alignment of children. */
    align: {
      baseline: "items-baseline",
      center: "items-center",
      end: "items-end",
      start: "items-start",
      stretch: "items-stretch",
    },
    /** Main-axis distribution of children. */
    justify: {
      around: "justify-around",
      between: "justify-between",
      center: "justify-center",
      end: "justify-end",
      evenly: "justify-evenly",
      start: "justify-start",
    },
    /** Whether children wrap onto multiple lines instead of overflowing/shrinking. Ignored while `collapseBelow` has stacked it, since a column never wraps. */
    wrap: {
      false: "flex-nowrap",
      true: "flex-wrap",
    },
  },
});

export type LayoutHStackAlignProps = VariantProps<
  typeof hstackVariants
>["align"];
export type LayoutHStackJustifyProps = VariantProps<
  typeof hstackVariants
>["justify"];

export interface LayoutHStackProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Cross-axis (vertical) alignment of children.
   * @default "center"
   */
  align?: LayoutHStackAlignProps;
  /**
   * Main-axis (horizontal) distribution of children.
   * @default "start"
   */
  justify?: LayoutHStackJustifyProps;
  /**
   * Space between children, from the shared `Layout` gap scale. Pass a
   * per-breakpoint map (e.g. `{ base: "sm", md: "md" }`) for a gap that
   * grows on larger screens.
   * @default "md"
   */
  gap?: LayoutResponsive<LayoutGap>;
  /**
   * Wraps children onto multiple lines instead of overflowing/shrinking them.
   * @default false
   */
  wrap?: boolean;
  /**
   * Below this breakpoint, switches to a vertical stack (`flex-col`) instead
   * of overflowing or shrinking a row that no longer fits — the common "row
   * on desktop, column on mobile" toolbar/nav pattern. Omit to stay
   * horizontal at every width.
   */
  collapseBelow?: LayoutBreakpoint;
}

/**
 * Horizontal flex stack — children laid out left to right with a consistent
 * `gap`. See `Layout.Stack` for the vertical counterpart, and
 * `collapseBelow` for having this one become a `Layout.Stack` below a
 * breakpoint instead of needing both and swapping between them.
 * @example
 * ```tsx
 * <Layout.HStack collapseBelow="md" gap="sm" justify="between">
 *   <Logo />
 *   <Nav />
 * </Layout.HStack>
 * ```
 */
function LayoutHStack({
  align,
  justify,
  gap = "md",
  wrap,
  collapseBelow,
  className,
  ...props
}: LayoutHStackProps) {
  return (
    <div
      className={cn(
        hstackVariants({
          align,
          justify,
          wrap,
        }),
        collapseBelow ? collapseVariants[collapseBelow] : "flex-row",
        resolveResponsive(gap, gapVariants),
        className,
      )}
      {...props}
    />
  );
}

/** `grid-cols-*` classes per column count and breakpoint, written out in full for the same reason as `gapVariants`. */
const gridColsVariants = {
  1: {
    "2xl": "2xl:grid-cols-1",
    base: "grid-cols-1",
    lg: "lg:grid-cols-1",
    md: "md:grid-cols-1",
    sm: "sm:grid-cols-1",
    xl: "xl:grid-cols-1",
  },
  2: {
    "2xl": "2xl:grid-cols-2",
    base: "grid-cols-2",
    lg: "lg:grid-cols-2",
    md: "md:grid-cols-2",
    sm: "sm:grid-cols-2",
    xl: "xl:grid-cols-2",
  },
  3: {
    "2xl": "2xl:grid-cols-3",
    base: "grid-cols-3",
    lg: "lg:grid-cols-3",
    md: "md:grid-cols-3",
    sm: "sm:grid-cols-3",
    xl: "xl:grid-cols-3",
  },
  4: {
    "2xl": "2xl:grid-cols-4",
    base: "grid-cols-4",
    lg: "lg:grid-cols-4",
    md: "md:grid-cols-4",
    sm: "sm:grid-cols-4",
    xl: "xl:grid-cols-4",
  },
  6: {
    "2xl": "2xl:grid-cols-6",
    base: "grid-cols-6",
    lg: "lg:grid-cols-6",
    md: "md:grid-cols-6",
    sm: "sm:grid-cols-6",
    xl: "xl:grid-cols-6",
  },
  12: {
    "2xl": "2xl:grid-cols-12",
    base: "grid-cols-12",
    lg: "lg:grid-cols-12",
    md: "md:grid-cols-12",
    sm: "sm:grid-cols-12",
    xl: "xl:grid-cols-12",
  },
} as const;

export type LayoutGridCols = keyof typeof gridColsVariants;

export interface LayoutGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Column count. Pass a per-breakpoint map (e.g.
   * `{ base: 1, md: 2, lg: 3 }`) for a column count that grows on larger
   * screens — the standard responsive card-grid pattern.
   * @default 1
   */
  cols?: LayoutResponsive<LayoutGridCols>;
  /**
   * Space between cells, from the shared `Layout` gap scale. Also accepts a
   * per-breakpoint map, same as `cols`.
   * @default "md"
   */
  gap?: LayoutResponsive<LayoutGap>;
}

/**
 * CSS grid with a column count and consistent `gap`, both of which can vary
 * per breakpoint.
 * @example
 * ```tsx
 * <Layout.Grid cols={{ base: 1, md: 2, lg: 3 }} gap="lg">
 *   <Card />
 *   <Card />
 *   <Card />
 * </Layout.Grid>
 * ```
 */
function LayoutGrid({
  cols = 1,
  gap = "md",
  className,
  ...props
}: LayoutGridProps) {
  return (
    <div
      className={cn(
        "grid",
        resolveResponsive(cols, gridColsVariants),
        resolveResponsive(gap, gapVariants),
        className,
      )}
      {...props}
    />
  );
}

const sectionVariants = cva("w-full", {
  defaultVariants: {
    spacing: "md",
  },
  variants: {
    /** Vertical padding — how much breathing room this section gets on a long page. */
    spacing: {
      lg: "py-16",
      md: "py-12",
      none: "py-0",
      sm: "py-8",
      xl: "py-24",
    },
  },
});

export type LayoutSectionVariantProps = VariantProps<
  typeof sectionVariants
>["spacing"];

export interface LayoutSectionProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * Vertical padding, for stacking distinct page sections with consistent
   * rhythm.
   * @default "md"
   */
  spacing?: LayoutSectionVariantProps;
}

/**
 * Semantic `<section>` with vertical spacing — pair with `Layout.Container`
 * inside it to also cap and center the section's content width.
 * @example
 * ```tsx
 * <Layout.Section spacing="lg">
 *   <Layout.Container>...</Layout.Container>
 * </Layout.Section>
 * ```
 */
function LayoutSection({ spacing, className, ...props }: LayoutSectionProps) {
  return (
    <section
      className={cn(
        sectionVariants({
          spacing,
        }),
        className,
      )}
      {...props}
    />
  );
}

/** Edges a `Layout.Fade` can bleed a color in from. */
export type LayoutFadeSide = "top" | "right" | "bottom" | "left";

/** Named groups of edges, so the common cases don't need an array: `"all"` is every edge, `"x"` the two horizontal ends (left + right), `"y"` the two vertical ends (top + bottom). */
const fadeSideGroups = {
  all: [
    "top",
    "right",
    "bottom",
    "left",
  ],
  x: [
    "left",
    "right",
  ],
  y: [
    "top",
    "bottom",
  ],
} as const satisfies Record<string, readonly LayoutFadeSide[]>;

/** Which edges a `Layout.Fade.Root` renders: a group name, one side, or an explicit list of sides. */
export type LayoutFadeSides =
  | LayoutFadeSide
  | keyof typeof fadeSideGroups
  | readonly LayoutFadeSide[];

function resolveFadeSides(sides: LayoutFadeSides): readonly LayoutFadeSide[] {
  if (typeof sides !== "string") return sides;
  if (sides in fadeSideGroups) {
    return fadeSideGroups[sides as keyof typeof fadeSideGroups];
  }
  return [
    sides as LayoutFadeSide,
  ];
}

/**
 * How far a fade reaches in from its edge, in `rem`, on the same rhythm as
 * the rest of the `Layout` scale. Exported so components that soften their
 * own edges with a different mechanism — `Marquee`, which masks its
 * content's alpha rather than painting a color over it — can share this one
 * scale instead of inventing their own numbers.
 */
export const LAYOUT_FADE_SIZES = {
  lg: 6,
  md: 4,
  sm: 2,
  xl: 8,
  xs: 1,
} as const;

export type LayoutFadeSize = keyof typeof LAYOUT_FADE_SIZES;

/** Theme tokens a fade can blend from, so the color of the adjoining surface stays on `src/index.css` instead of being hardcoded per usage. */
const fadeColorVariants = {
  background: "var(--background)",
  inverse: "var(--inverse-background)",
  muted: "var(--muted)",
  overlay: "var(--overlay)",
} as const;

/**
 * Color the fade starts from at the edge. A token key resolves to its CSS
 * custom property; any other string is passed through as a raw CSS color,
 * for the rare case where the adjoining surface isn't a design token.
 */
export type LayoutFadeColor = keyof typeof fadeColorVariants | (string & {});

function fadeColorValue(color: LayoutFadeColor): string {
  return color in fadeColorVariants
    ? fadeColorVariants[color as keyof typeof fadeColorVariants]
    : color;
}

/** Direction a gradient travels for a given edge: always *away* from that edge, so the color sits on the edge itself and dissolves inward. */
const fadeGradientDirection = {
  bottom: "to top",
  left: "to right",
  right: "to left",
  top: "to bottom",
} as const;

/** How the fade's alpha falls off across its length. */
export type LayoutFadeEasing = "linear" | "smooth";

function fadeGradient(
  side: LayoutFadeSide,
  color: LayoutFadeColor,
  easing: LayoutFadeEasing,
): string {
  const value = fadeColorValue(color);
  const direction = fadeGradientDirection[side];

  if (easing === "linear") {
    return `linear-gradient(${direction}, ${value} 0%, transparent 100%)`;
  }

  // Extra stops approximate an ease-out curve: a straight two-stop gradient
  // keeps too much opacity through the middle and ends in a visible edge.
  return [
    `linear-gradient(${direction}`,
    `${value} 0%`,
    `color-mix(in oklab, ${value} 78%, transparent) 20%`,
    `color-mix(in oklab, ${value} 45%, transparent) 42%`,
    `color-mix(in oklab, ${value} 18%, transparent) 67%`,
    `transparent 100%)`,
  ].join(", ");
}

/**
 * Alpha stops the `"smooth"` curve passes through, as
 * `[fraction of the fade's length, alpha]` pairs measured from the fully
 * transparent end. They're the inverse of the color stops
 * `fadeGradient` paints — an overlay that still covers 78% of the surface
 * at 20% of its length leaves 22% of the content showing — so a masked
 * fade and a painted one tail off along the same curve.
 */
const fadeSmoothStops = [
  [
    0,
    0,
  ],
  [
    0.2,
    0.22,
  ],
  [
    0.42,
    0.55,
  ],
  [
    0.67,
    0.82,
  ],
  [
    1,
    1,
  ],
] as const satisfies readonly (readonly [
  number,
  number,
])[];

const fadeLinearStops = [
  [
    0,
    0,
  ],
  [
    1,
    1,
  ],
] as const satisfies readonly (readonly [
  number,
  number,
])[];

/** A mask color for an alpha in 0…1 — `mask-image` reads only the alpha channel, so the hue is irrelevant. */
function fadeMaskColor(alpha: number): string {
  if (alpha <= 0) return "transparent";
  if (alpha >= 1) return "#000";
  return `rgb(0 0 0 / ${Math.round(alpha * 100)}%)`;
}

/** Trims float noise out of a computed `rem` length (`0.8400000000000001rem`). */
function fadeRem(value: number): string {
  return `${Math.round(value * 1000) / 1000}rem`;
}

/**
 * Builds a `mask-image` gradient that dissolves content's *own* alpha at
 * both ends of `axis`, over `LAYOUT_FADE_SIZES[size]` at each end.
 *
 * This is the counterpart to `Layout.Fade` for content that scrolls or sits
 * over an unknown surface: `Layout.Fade` paints the neighbouring color on
 * top, which needs that color to be known, while a mask makes the content
 * itself transparent and so works over any background, image, or gradient.
 * Both share `LAYOUT_FADE_SIZES` and the same falloff curve, so the two
 * mechanisms read as one system.
 * @example
 * ```tsx
 * <div style={{ maskImage: layoutFadeMask("x", "md") }}>…</div>
 * ```
 */
export function layoutFadeMask(
  axis: "x" | "y",
  size: LayoutFadeSize = "md",
  easing: LayoutFadeEasing = "smooth",
): string {
  const length = LAYOUT_FADE_SIZES[size];
  const direction = axis === "x" ? "to right" : "to bottom";
  const stops = easing === "linear" ? fadeLinearStops : fadeSmoothStops;

  const leading = stops.map(
    ([fraction, alpha]) =>
      `${fadeMaskColor(alpha)} ${fadeRem(fraction * length)}`,
  );
  // Mirrored, so both ends fade identically and the middle stays opaque.
  const trailing = [
    ...stops,
  ]
    .reverse()
    .map(
      ([fraction, alpha]) =>
        `${fadeMaskColor(alpha)} calc(100% - ${fadeRem(fraction * length)})`,
    );

  return `linear-gradient(${direction}, ${[
    ...leading,
    ...trailing,
  ].join(", ")})`;
}

interface LayoutFadeContextValue {
  color: LayoutFadeColor;
  easing: LayoutFadeEasing;
  size: LayoutFadeSize;
}

const LayoutFadeContext = React.createContext<LayoutFadeContextValue | null>(
  null,
);

function useLayoutFadeContext(component: string): LayoutFadeContextValue {
  const context = React.useContext(LayoutFadeContext);
  if (!context) {
    throw new Error(
      `\`${component}\` must be used inside \`Layout.Fade.Root\`.`,
    );
  }
  return context;
}

export interface LayoutFadeRootProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Which edges get a fade. `"all"` covers every edge, `"x"` the two
   * horizontal ends (left + right), `"y"` the two vertical ends (top +
   * bottom); a single side name or an explicit array works too. Pass
   * `sides={[]}` to render no edge automatically and place
   * `Layout.Fade.Edge` children by hand instead.
   * @default "y"
   */
  sides?: LayoutFadeSides;
  /**
   * Color each edge fades from — normally the surface on the other side of
   * that edge, so the seam between two sections reads as a blend instead of
   * a hard line. `"background"` and `"inverse"` are the light↔dark pair.
   * Overridable per edge on `Layout.Fade.Edge`.
   * @default "background"
   */
  color?: LayoutFadeColor;
  /**
   * How far each fade reaches in from its edge.
   * @default "md"
   */
  size?: LayoutFadeSize;
  /**
   * Falloff curve. `"smooth"` uses extra stops to approximate an ease-out,
   * which avoids the banded edge a two-stop `"linear"` gradient leaves.
   * @default "smooth"
   */
  easing?: LayoutFadeEasing;
}

/**
 * Wraps content and bleeds a color in from the chosen edges, so the boundary
 * between two surfaces of different colors reads as a gradient rather than a
 * hard cut. The overlays are decorative: they're `aria-hidden` and let
 * pointer events through, so content underneath stays fully interactive.
 *
 * To soften a light section sitting above a dark one, give the dark section a
 * top fade in the light section's color (or vice versa) — the two halves of a
 * light↔dark transition are `color="background"` and `color="inverse"`.
 * @example
 * ```tsx
 * <Layout.Fade.Root className="bg-[var(--inverse-background)]" color="background" sides="y">
 *   <Layout.Section>...</Layout.Section>
 * </Layout.Fade.Root>
 * ```
 */
function LayoutFadeRoot({
  sides = "y",
  color = "background",
  size = "md",
  easing = "smooth",
  className,
  children,
  ...props
}: LayoutFadeRootProps) {
  const context = React.useMemo<LayoutFadeContextValue>(
    () => ({
      color,
      easing,
      size,
    }),
    [
      color,
      easing,
      size,
    ],
  );

  return (
    <LayoutFadeContext.Provider value={context}>
      <div
        className={cn("relative isolate", className)}
        {...props}
      >
        {children}
        {resolveFadeSides(sides).map((side) => (
          <LayoutFadeEdge
            key={side}
            side={side}
          />
        ))}
      </div>
    </LayoutFadeContext.Provider>
  );
}

export interface LayoutFadeEdgeProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "color"> {
  /** Edge this overlay sits on; the gradient starts opaque there and dissolves inward. */
  side: LayoutFadeSide;
  /**
   * Color this edge fades from, overriding the `Layout.Fade.Root` value for
   * this edge alone — for a block whose neighbours differ on each side.
   * @default the root's `color`
   */
  color?: LayoutFadeColor;
  /**
   * How far this edge reaches in, overriding the root's `size`.
   * @default the root's `size`
   */
  size?: LayoutFadeSize;
  /**
   * Falloff curve for this edge, overriding the root's `easing`.
   * @default the root's `easing`
   */
  easing?: LayoutFadeEasing;
}

const fadeEdgeVariants = cva("pointer-events-none absolute z-10", {
  variants: {
    /** Edge the overlay is pinned to, and the axis it therefore spans. */
    side: {
      bottom: "inset-x-0 bottom-0",
      left: "inset-y-0 left-0",
      right: "inset-y-0 right-0",
      top: "inset-x-0 top-0",
    },
  },
});

/**
 * A single decorative fade overlay pinned to one edge of its
 * `Layout.Fade.Root`. `Root` renders these for you from its `sides` prop;
 * render them directly (with `sides={[]}`) only when an edge needs its own
 * `color`, `size`, or `easing`.
 * @example
 * ```tsx
 * <Layout.Fade.Root sides={[]}>
 *   <Content />
 *   <Layout.Fade.Edge color="background" side="top" />
 *   <Layout.Fade.Edge color="inverse" side="bottom" size="xl" />
 * </Layout.Fade.Root>
 * ```
 */
function LayoutFadeEdge({
  side,
  color,
  size,
  easing,
  className,
  style,
  ...props
}: LayoutFadeEdgeProps) {
  const context = useLayoutFadeContext("Layout.Fade.Edge");
  const resolvedSize = fadeRem(LAYOUT_FADE_SIZES[size ?? context.size]);
  const isHorizontalEdge = side === "top" || side === "bottom";

  return (
    <div
      aria-hidden="true"
      className={cn(
        fadeEdgeVariants({
          side,
        }),
        className,
      )}
      style={{
        backgroundImage: fadeGradient(
          side,
          color ?? context.color,
          easing ?? context.easing,
        ),
        ...(isHorizontalEdge
          ? {
              height: resolvedSize,
            }
          : {
              width: resolvedSize,
            }),
        ...style,
      }}
      {...props}
    />
  );
}

/**
 * Softens the seam between two surfaces of different colors by bleeding one
 * color into the other across a gradient, instead of cutting between them.
 * `Root` wraps the content and renders an `Edge` per side in its `sides`
 * prop (`"all"`, `"x"`, `"y"`, a single side, or a list); `Edge` is exposed
 * for the case where each edge needs a different color or depth.
 * @example
 * ```tsx
 * <Layout.Fade.Root color="background" sides="y" size="lg">
 *   <Layout.Section className="bg-[var(--inverse-background)]">...</Layout.Section>
 * </Layout.Fade.Root>
 * ```
 */
const LayoutFade = {
  Edge: LayoutFadeEdge,
  Root: LayoutFadeRoot,
};

/**
 * Compound set of layout primitives — `Container`/`Section` for page-level
 * width and rhythm, `Stack`/`HStack` for flex arrangement, `Grid` for a
 * column grid, `Fade` for softening the seam between two surfaces of
 * different colors — built on `class-variance-authority` and `cn` like every
 * other variant-driven component in this library, so spacing/alignment stay
 * off ad hoc `className`s and on the same shared scale. `gap`, `Grid.cols`,
 * and `HStack.collapseBelow` all take a `LayoutResponsive` value (one fixed
 * value, or a `{ base, sm, md, lg, xl, "2xl" }` map) for behavior that
 * changes per breakpoint.
 * @example
 * ```tsx
 * <Layout.Section>
 *   <Layout.Container>
 *     <Layout.Stack gap={{ base: "sm", lg: "lg" }}>
 *       <Layout.HStack collapseBelow="md" justify="between">
 *         <Logo />
 *         <Nav />
 *       </Layout.HStack>
 *       <Layout.Grid cols={{ base: 1, md: 2, lg: 3 }} gap="md">
 *         <Card />
 *         <Card />
 *         <Card />
 *       </Layout.Grid>
 *     </Layout.Stack>
 *   </Layout.Container>
 * </Layout.Section>
 * ```
 */
export const Layout = {
  Container: LayoutContainer,
  Fade: LayoutFade,
  Grid: LayoutGrid,
  HStack: LayoutHStack,
  Section: LayoutSection,
  Stack: LayoutStack,
};
