"use client";

import { cva } from "class-variance-authority";
import * as React from "react";
import type {
  BarShapeProps,
  PieSectorShapeProps,
  SankeyLinkProps,
  SankeyNodeProps,
  TooltipContentProps,
  TreemapNode,
} from "recharts";
import {
  Area,
  Bar,
  CartesianGrid,
  Funnel,
  LabelList,
  Legend,
  Line,
  Pie,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  AreaChart as RechartsAreaChart,
  BarChart as RechartsBarChart,
  FunnelChart as RechartsFunnelChart,
  LineChart as RechartsLineChart,
  PieChart as RechartsPieChart,
  RadarChart as RechartsRadarChart,
  ScatterChart as RechartsScatterChart,
  Rectangle,
  ReferenceLine,
  ResponsiveContainer,
  Sankey,
  Scatter,
  Sector,
  Tooltip,
  Trapezoid,
  Treemap,
  useChartHeight,
  useChartWidth,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { IconTooltip } from "../../overlays-feedback/tooltip/tooltip";
import {
  buildDumbbell,
  type DumbbellRow,
  type DumbbellRowInput,
  type DumbbellSort,
} from "../../utils/chart/dumbbell";
import {
  buildGantt,
  durationInDays,
  formatGanttDate,
  formatGanttTick,
  type GanttDateLike,
  type GanttRow,
  type GanttSort,
  type GanttStep,
  type GanttTaskInput,
  toTime,
} from "../../utils/chart/gantt";
import {
  binValues,
  type HistogramBin,
  type HistogramRule,
  quantile,
} from "../../utils/chart/histogram";
import {
  type SankeyLinkInput,
  type SankeyNodeInput,
  toSankeyData,
} from "../../utils/chart/sankey";
import {
  buildWaterfall,
  type WaterfallStep,
  type WaterfallStepInput,
} from "../../utils/chart/waterfall";
import { cn } from "../../utils/tailwind/cn";
import { Card } from "../card/card";

/**
 * Named pastel colors for chart series. They point at the `--chart-*` tokens
 * in `src/index.css`, which carry a light and a dark value, so the same
 * `color` prop looks right in both themes without the consumer branching.
 * Categorical data is the one place this library uses hue beyond semantic
 * state (like `--json-key`): a legend, not decoration. `--success`/`--warning`/
 * `--destructive` stay out of it so they keep meaning good/bad. Raw CSS color
 * strings (not Tailwind classes), since recharts paints SVG presentation
 * attributes directly.
 */
export const CHART_COLORS = {
  amber: "var(--chart-2)",
  blue: "var(--chart-1)",
  green: "var(--chart-3)",
  rose: "var(--chart-4)",
  teal: "var(--chart-6)",
  violet: "var(--chart-5)",
} as const;

/**
 * Default color rotation for series/slices that don't set their own `color`.
 * The palette is built into the charts (no setup needed); any series, slice or
 * node can still override it with a `color` prop — a `CHART_COLORS` entry, a
 * `var(--token)` or any CSS color.
 */
export const CHART_PALETTE = [
  CHART_COLORS.blue,
  CHART_COLORS.amber,
  CHART_COLORS.green,
  CHART_COLORS.rose,
  CHART_COLORS.violet,
  CHART_COLORS.teal,
] as const;

/**
 * How filled marks (bars, areas, slices, treemap cells) are painted:
 * `"solid"` is a flat pastel fill, `"stripes"` adds fine diagonal lines in a
 * deeper tone of the same color. Beyond looking lively, the texture keeps
 * series distinguishable without relying on color alone.
 */
export type ChartPattern = "solid" | "stripes";

/** Deeper (light theme) / lighter (dark theme) tone of `color` — mixed toward `--foreground` — for outlines, lines and stripes, so pastel marks keep a crisp edge against the canvas. */
function chartStroke(color: string, amount = 38) {
  return `color-mix(in oklab, ${color}, var(--foreground) ${amount}%)`;
}

const PATTERN_SIZE = 8;

interface ChartStripePatternProps {
  id: string;
  color: string;
  /** Opacity of the pastel base (stripes keep theirs). */
  opacity?: number;
}

/** SVG `<pattern>`: the pastel `color` as a base with diagonal stripes on top. Render inside the chart's `<defs>` and reference as `url(#id)`. */
function ChartStripePattern({
  id,
  color,
  opacity = 1,
}: ChartStripePatternProps) {
  return (
    <pattern
      height={PATTERN_SIZE}
      id={id}
      patternTransform="rotate(45)"
      patternUnits="userSpaceOnUse"
      width={PATTERN_SIZE}
    >
      <rect
        fill={color}
        fillOpacity={opacity}
        height={PATTERN_SIZE}
        width={PATTERN_SIZE}
      />
      <line
        stroke={chartStroke(color, 30)}
        strokeOpacity={0.45}
        strokeWidth={2}
        x1={0}
        x2={0}
        y1={0}
        y2={PATTERN_SIZE}
      />
    </pattern>
  );
}

/** Per-chart unique prefix for pattern ids (two charts on one page must not share `<pattern>` ids). */
function useChartPatternId() {
  return React.useId().replace(/:/g, "");
}

/** Copies each item's resolved color into its `fill`. Slices/stages are painted by a custom `shape`, so recharts never sees the color — but it builds legend and tooltip swatches from the data item's `fill`, and would fall back to gray without it. */
function withFill<
  T extends {
    color?: string;
  },
>(
  items: T[],
): (T & {
  fill: string;
})[] {
  return items.map((item, index) => ({
    ...item,
    fill: item.color ?? CHART_PALETTE[index % CHART_PALETTE.length],
  }));
}

const CHART_GRID_COLOR = "var(--border)";
const CHART_AXIS_COLOR = "var(--border-strong)";
const CHART_TICK_COLOR = "var(--muted-foreground)";
const CHART_CURSOR_COLOR = "var(--muted)";
// Pastel fills are light in both themes, so labels on them are always dark ink.
const CHART_LABEL_ON_FILL_COLOR = "var(--black)";

/** Legend entries are colored by their series (pastel), which is unreadable as text; keep the swatch and set the label in the muted-text color. */
const legendFormatter = (value: string) => (
  <span
    style={{
      color: CHART_TICK_COLOR,
    }}
  >
    {value}
  </span>
);

const TICK_STYLE = {
  fill: CHART_TICK_COLOR,
  fontSize: 12,
} as const;

/**
 * How stacked series are laid out: `"absolute"` adds the real values up,
 * `"percent"` normalizes every point to 100% so the chart reads as
 * composition over time rather than volume.
 */
export type ChartStack = "absolute" | "percent";

/** Shared `stackId` given to series that don't declare one under `stack="percent"` — only stacked series can be normalized, so the prop would otherwise do nothing. */
const PERCENT_STACK_ID = "chart-percent-stack";

/** Formats a normalized 0–1 stacked share as a whole percentage, for the value axis under `stack="percent"`. */
const percentTick = (value: number) => `${Math.round(value * 100)}%`;

/** Value axis props that turn a normalized stack's 0–1 scale into a 0–100% one. */
const PERCENT_AXIS = {
  domain: [
    0,
    1,
  ],
  tickFormatter: percentTick,
} as const;

function axisLabel(
  value: string | undefined,
  position: "insideBottom" | "insideLeft",
) {
  if (!value) return undefined;
  return position === "insideBottom"
    ? {
        fill: CHART_TICK_COLOR,
        fontSize: 12,
        offset: -16,
        position,
        value,
      }
    : {
        angle: -90,
        fill: CHART_TICK_COLOR,
        fontSize: 12,
        position,
        value,
      };
}

function chartMargin(
  xAxisLabel: string | undefined,
  yAxisLabel: string | undefined,
) {
  return {
    bottom: xAxisLabel ? 24 : 8,
    left: yAxisLabel ? 24 : 8,
    right: 16,
    top: 8,
  };
}

const chartVariants = cva("w-full", {
  defaultVariants: {
    size: "md",
  },
  variants: {
    /**
     * Preset height. Overridden outright by an explicit `height` prop, for
     * the rare case a fixed pixel value is needed instead of the scale.
     */
    size: {
      lg: "",
      md: "",
      sm: "",
    },
  },
});

const sizeToHeight = {
  lg: 400,
  md: 300,
  sm: 220,
} as const;

export type ChartSize = keyof typeof sizeToHeight;

export interface ChartFrameProps {
  /** Heading of the chart, shown above it. When any of `title`/`description`/`source` is set, the chart is wrapped in a `<figure>` labelled by the title. */
  title?: React.ReactNode;
  /** Supporting text under the title: what the chart shows, over which period, in which unit. */
  description?: React.ReactNode;
  /** Small caption under the chart, for citing where the data comes from (e.g. `"Source: Eurostat, 2024"`). Rendered in the figure's `<figcaption>`, under a hairline. */
  source?: React.ReactNode;
  /** Extra footnote under `source` — caveats about the data or method (e.g. `"Note: 2023 figures are estimates."`). */
  note?: React.ReactNode;
  /**
   * Heading element used for `title`, so the chart fits the page's outline.
   * @default "h3"
   */
  titleAs?: "h2" | "h3" | "h4" | "h5" | "h6";
}

export interface ChartContainerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    ChartFrameProps {
  size?: ChartSize;
  height?: number;
}

/** Shared responsive wrapper every `Chart.*` renders into — `w-full` so its width always follows its parent, with a `size` preset (or an explicit `height` override) for the fixed pixel height `ResponsiveContainer` needs. */
function ChartContainer({
  size = "md",
  height,
  className,
  children,
  // Frame props are consumed by `withChartFrame`, never by the plot box.
  title: _title,
  description: _description,
  source: _source,
  note: _note,
  titleAs: _titleAs,
  ...props
}: ChartContainerProps) {
  return (
    <div
      className={cn(
        chartVariants({
          size,
        }),
        className,
      )}
      style={{
        height: height ?? sizeToHeight[size],
      }}
      {...props}
    >
      <ResponsiveContainer
        height="100%"
        width="100%"
      >
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Wraps a chart in a `<figure>` with an optional title, description and source
 * caption. Renders nothing extra (the bare chart) when none of them is given,
 * so charts without a frame keep exactly the markup they had.
 */
function ChartFrame({
  title,
  description,
  source,
  note,
  titleAs: Heading = "h3",
  children,
}: ChartFrameProps & {
  children: React.ReactNode;
}) {
  const id = React.useId();
  const hasHeader = title !== undefined || description !== undefined;
  const hasFooter = source !== undefined || note !== undefined;
  if (!hasHeader && !hasFooter) return <>{children}</>;

  return (
    <figure
      aria-describedby={
        description !== undefined ? `${id}-description` : undefined
      }
      aria-labelledby={title !== undefined ? `${id}-title` : undefined}
      className="m-0 flex w-full flex-col gap-4"
    >
      {hasHeader && (
        <div className="flex flex-col gap-1.5">
          {title !== undefined && (
            <Heading
              className="font-primary text-lg font-semibold leading-tight text-foreground"
              id={`${id}-title`}
            >
              {title}
            </Heading>
          )}
          {description !== undefined && (
            <p
              className="font-primary text-sm text-muted-foreground"
              id={`${id}-description`}
            >
              {description}
            </p>
          )}
        </div>
      )}
      {children}
      {hasFooter && (
        <figcaption className="flex flex-col gap-0.5 border-t border-border pt-3 font-primary text-xs text-muted-foreground">
          {source !== undefined && <span>{source}</span>}
          {note !== undefined && <span>{note}</span>}
        </figcaption>
      )}
    </figure>
  );
}

/** Gives a chart component the `title` / `description` / `source` props by wrapping it in `ChartFrame`. The frame props are removed before the chart itself renders. */
function withChartFrame<P extends ChartFrameProps>(
  Component: React.ComponentType<P>,
): (props: P) => React.JSX.Element {
  function Framed(props: P) {
    const { title, description, source, note, titleAs, ...chart } = props;
    return (
      <ChartFrame
        description={description}
        note={note}
        source={source}
        title={title}
        titleAs={titleAs}
      >
        <Component {...(chart as unknown as P)} />
      </ChartFrame>
    );
  }
  Framed.displayName = `Framed(${Component.displayName ?? Component.name})`;
  return Framed;
}

const tooltipClassName =
  "rounded-md border border-border bg-background p-3 font-primary text-xs text-foreground shadow-md";

export type ChartValueFormatter = (value: number, dataKey: string) => string;

/** Shared tooltip for the series-based charts (`Area`/`Bar`/`Line`) — one entry per hovered series, a color swatch, and an optional `valueFormatter`. */
function ChartSeriesTooltip({
  active,
  payload,
  label,
  valueFormatter,
  percent,
}: TooltipContentProps & {
  valueFormatter?: ChartValueFormatter;
  /** Appends each entry's share of the hovered point's total — the value axis shows shares under `stack="percent"`, so the raw number alone loses that reading. */
  percent?: boolean;
}) {
  if (!active || !payload?.length) return null;

  const total = percent
    ? payload.reduce(
        (sum, entry) => sum + Math.abs(Number(entry.value) || 0),
        0,
      )
    : 0;

  return (
    <div className={tooltipClassName}>
      {label !== undefined && (
        <p className="mb-2 font-medium text-muted-foreground">{label}</p>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((entry) => (
          <div
            className="flex items-center gap-2"
            key={String(entry.dataKey ?? entry.name)}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                background: entry.color,
              }}
            />
            <span className="font-medium">
              {String(entry.name ?? entry.dataKey)}:
            </span>
            <span>
              {valueFormatter
                ? valueFormatter(Number(entry.value), String(entry.dataKey))
                : String(entry.value)}
            </span>
            {total > 0 && (
              <span className="text-muted-foreground">
                {percentTick(Math.abs(Number(entry.value) || 0) / total)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Shared tooltip for a single-value chart (`Donut`) — one swatch + name + value, no series list. */
function ChartSingleTooltip({
  active,
  payload,
  valueFormatter,
}: TooltipContentProps & {
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry) return null;
  // Slices/stages are painted by a custom shape, so `entry.color` can be
  // recharts' gray; the data item's own `fill` (see `withFill`) is the truth.
  const swatch =
    (
      entry.payload as
        | {
            fill?: string;
          }
        | undefined
    )?.fill ?? entry.color;

  return (
    <div className={tooltipClassName}>
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{
            background: swatch,
          }}
        />
        <span className="font-medium">{String(entry.name)}:</span>
        <span>
          {valueFormatter
            ? valueFormatter(Number(entry.value))
            : String(entry.value)}
        </span>
      </div>
    </div>
  );
}

// ─── Area ────────────────────────────────────────────────────────────────────

type ChartCurveType =
  | "basis"
  | "basisClosed"
  | "basisOpen"
  | "linear"
  | "linearClosed"
  | "natural"
  | "monotoneX"
  | "monotoneY"
  | "monotone"
  | "step"
  | "stepBefore"
  | "stepAfter";

export interface ChartAreaSeries {
  /** Key in each data object whose value determines the area boundary. */
  dataKey: string;
  /** Human-readable label shown in the legend and tooltip. */
  name?: string;
  /** Stroke/fill color; falls back to `CHART_PALETTE[index]` when omitted. */
  color?: string;
  /** Areas sharing a `stackId` stack on top of each other; omit for overlapping (non-stacked) areas. */
  stackId?: string;
  /**
   * Opacity of a flat area fill (0–1). Ignored when `gradient` is true.
   * @default 0.15
   */
  fillOpacity?: number;
  /**
   * Stroke width in px.
   * @default 2
   */
  strokeWidth?: number;
  /**
   * Curve interpolation; `"monotone"` avoids artificial inflection points.
   * @default "monotone"
   */
  type?: ChartCurveType;
  /**
   * Renders an SVG gradient fading to transparent toward the bottom instead
   * of a flat fill. Ignored when the resolved `pattern` is `"stripes"`.
   * @default true — except under `stack="percent"`, where bands must read as
   * solid regions, so a flat fill is the default there.
   */
  gradient?: boolean;
  /** Fill style for this series; overrides the chart's `pattern`. */
  pattern?: ChartPattern;
}

export interface ChartAreaProps extends ChartContainerProps {
  /** Array of data objects. */
  data: Record<string, unknown>[];
  /** Key in each data object used as the X-axis category label. */
  xAxisKey: string;
  /** One entry per area series. */
  areas: ChartAreaSeries[];
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend below the chart.
   * @default false
   */
  legend?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the X axis. */
  xAxisLabel?: string;
  /** Text label rendered left of the Y axis. */
  yAxisLabel?: string;
  /**
   * Bridges null/missing data points by connecting the surrounding non-null
   * points instead of leaving a gap.
   * @default false
   */
  connectNulls?: boolean;
  /** Formats a raw numeric value for the tooltip; receives the series' `dataKey`. */
  valueFormatter?: ChartValueFormatter;
  /**
   * Fill style for every series that doesn't set its own `pattern`.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * `"absolute"` — stacked areas add up to their real total. `"percent"` —
   * every point is normalized to 100%, for reading how the mix shifts over
   * time instead of how the total grows. Series without a `stackId` get a
   * shared one, so the prop works on its own.
   * @default "absolute"
   */
  stack?: ChartStack;
}

/**
 * Area chart — a filled line, e.g. for a value trending over time. One of
 * the compound `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Area
 *   areas={[{ dataKey: "revenue" }]}
 *   data={data}
 *   xAxisKey="month"
 * />
 * ```
 */
function ChartArea({
  data,
  xAxisKey,
  areas,
  size,
  height,
  tooltip = true,
  legend = false,
  grid = true,
  xAxisLabel,
  yAxisLabel,
  connectNulls = false,
  className,
  valueFormatter,
  pattern = "solid",
  stack = "absolute",
}: ChartAreaProps) {
  const uid = useChartPatternId();
  const isPercent = stack === "percent";
  return (
    <ChartContainer
      className={className}
      height={height}
      size={size}
    >
      <RechartsAreaChart
        data={data}
        margin={chartMargin(xAxisLabel, yAxisLabel)}
        stackOffset={isPercent ? "expand" : undefined}
      >
        <defs>
          {areas.map((area, index) => {
            const color =
              area.color ?? CHART_PALETTE[index % CHART_PALETTE.length];
            if ((area.pattern ?? pattern) === "stripes")
              return (
                <ChartStripePattern
                  color={color}
                  id={`${uid}-${index}`}
                  key={area.dataKey}
                  opacity={0.45}
                />
              );
            if (!(area.gradient ?? !isPercent)) return null;
            return (
              <linearGradient
                id={`chart-area-gradient-${area.dataKey}`}
                key={area.dataKey}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={color}
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor={color}
                  stopOpacity={0}
                />
              </linearGradient>
            );
          })}
        </defs>

        {grid && (
          <CartesianGrid
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
          />
        )}

        <XAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          dataKey={xAxisKey}
          label={axisLabel(xAxisLabel, "insideBottom")}
          tick={TICK_STYLE}
          tickLine={false}
        />
        <YAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          label={axisLabel(yAxisLabel, "insideLeft")}
          tick={TICK_STYLE}
          tickLine={false}
          {...(isPercent && PERCENT_AXIS)}
        />

        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartSeriesTooltip
                {...props}
                percent={isPercent}
                valueFormatter={valueFormatter}
              />
            )}
          />
        )}
        {legend && (
          <Legend
            formatter={legendFormatter}
            wrapperStyle={{
              color: CHART_TICK_COLOR,
              fontSize: 12,
              paddingTop: 16,
            }}
          />
        )}

        {areas.map((area, index) => {
          const color =
            area.color ?? CHART_PALETTE[index % CHART_PALETTE.length];
          const line = area.color ?? chartStroke(color);
          const striped = (area.pattern ?? pattern) === "stripes";
          const useGradient = !striped && (area.gradient ?? !isPercent);
          return (
            <Area
              activeDot={{
                fill: line,
                r: 5,
                strokeWidth: 0,
              }}
              connectNulls={connectNulls}
              dataKey={area.dataKey}
              dot={false}
              fill={
                striped
                  ? `url(#${uid}-${index})`
                  : useGradient
                    ? `url(#chart-area-gradient-${area.dataKey})`
                    : color
              }
              fillOpacity={
                striped || useGradient
                  ? 1
                  : (area.fillOpacity ?? (isPercent ? 0.85 : 0.15))
              }
              key={area.dataKey}
              name={area.name ?? area.dataKey}
              stackId={
                area.stackId ?? (isPercent ? PERCENT_STACK_ID : undefined)
              }
              stroke={line}
              strokeWidth={area.strokeWidth ?? 2}
              type={area.type ?? "monotone"}
            />
          );
        })}
      </RechartsAreaChart>
    </ChartContainer>
  );
}

// ─── Bar ─────────────────────────────────────────────────────────────────────

export interface ChartBarSeries {
  /** Key in each data object whose numeric value determines bar height. */
  dataKey: string;
  /** Human-readable label shown in the legend and tooltip. */
  name?: string;
  /** Fill color; falls back to `CHART_PALETTE[index]` when omitted. */
  color?: string;
  /** Bars sharing a `stackId` stack on top of each other; omit for grouped (side-by-side) bars. */
  stackId?: string;
  /** Corner radius: a single number, or `[topLeft, topRight, bottomRight, bottomLeft]`. */
  radius?:
    | [
        number,
        number,
        number,
        number,
      ]
    | number;
  /** Fill style for this series; overrides the chart's `pattern`. */
  pattern?: ChartPattern;
}

export interface ChartBarProps extends ChartContainerProps {
  /** Array of data objects — every key used in `bars[].dataKey` must be present. */
  data: Record<string, unknown>[];
  /** Key in each data object used as the category (X-axis) label. */
  xAxisKey: string;
  /** One entry per bar series. */
  bars: ChartBarSeries[];
  /**
   * `"horizontal"` — bars grow upward (a standard column chart).
   * `"vertical"` — bars grow rightward (a horizontal bar chart).
   * @default "horizontal"
   */
  layout?: "horizontal" | "vertical";
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend below the chart.
   * @default false
   */
  legend?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the X axis. */
  xAxisLabel?: string;
  /** Text label rendered left of the Y axis. */
  yAxisLabel?: string;
  /**
   * Milliseconds before the entry animation begins.
   * @default 0
   */
  animationBegin?: number;
  /** Duration of the entry animation in milliseconds. */
  animationDuration?: number;
  /** Formats a raw numeric value for the tooltip; receives the series' `dataKey`. */
  valueFormatter?: ChartValueFormatter;
  /**
   * Fill style for every series that doesn't set its own `pattern`.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * `"absolute"` — stacked bars add up to their real total. `"percent"` —
   * every bar is normalized to 100%, for comparing the mix across categories
   * regardless of their size. Series without a `stackId` get a shared one, so
   * the prop works on its own.
   * @default "absolute"
   */
  stack?: ChartStack;
}

/**
 * Bar chart, grouped or stacked, horizontal or vertical layout. One of the
 * compound `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Bar bars={[{ dataKey: "signups" }]} data={data} xAxisKey="month" />
 * ```
 */
function ChartBar({
  data,
  xAxisKey,
  bars,
  size,
  height,
  layout = "horizontal",
  tooltip = true,
  legend = false,
  grid = true,
  xAxisLabel,
  yAxisLabel,
  animationBegin = 0,
  animationDuration,
  className,
  valueFormatter,
  pattern = "solid",
  stack = "absolute",
}: ChartBarProps) {
  const isVertical = layout === "vertical";
  const uid = useChartPatternId();
  const isPercent = stack === "percent";

  return (
    <ChartContainer
      className={className}
      height={height}
      size={size}
    >
      <RechartsBarChart
        data={data}
        layout={layout}
        margin={chartMargin(xAxisLabel, yAxisLabel)}
        stackOffset={isPercent ? "expand" : undefined}
      >
        <defs>
          {bars.map((bar, index) =>
            (bar.pattern ?? pattern) === "stripes" ? (
              <ChartStripePattern
                color={bar.color ?? CHART_PALETTE[index % CHART_PALETTE.length]}
                id={`${uid}-${index}`}
                key={bar.dataKey}
              />
            ) : null,
          )}
        </defs>
        {grid && (
          <CartesianGrid
            horizontal={!isVertical}
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
            vertical={isVertical}
          />
        )}

        {isVertical ? (
          <>
            <XAxis
              axisLine={{
                stroke: CHART_AXIS_COLOR,
              }}
              label={axisLabel(xAxisLabel, "insideBottom")}
              tick={TICK_STYLE}
              tickLine={false}
              type="number"
              {...(isPercent && PERCENT_AXIS)}
            />
            <YAxis
              axisLine={{
                stroke: CHART_AXIS_COLOR,
              }}
              dataKey={xAxisKey}
              label={axisLabel(yAxisLabel, "insideLeft")}
              tick={TICK_STYLE}
              tickLine={false}
              type="category"
              width={80}
            />
          </>
        ) : (
          <>
            <XAxis
              axisLine={{
                stroke: CHART_AXIS_COLOR,
              }}
              dataKey={xAxisKey}
              label={axisLabel(xAxisLabel, "insideBottom")}
              tick={TICK_STYLE}
              tickLine={false}
            />
            <YAxis
              axisLine={{
                stroke: CHART_AXIS_COLOR,
              }}
              label={axisLabel(yAxisLabel, "insideLeft")}
              tick={TICK_STYLE}
              tickLine={false}
              {...(isPercent && PERCENT_AXIS)}
            />
          </>
        )}

        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartSeriesTooltip
                {...props}
                percent={isPercent}
                valueFormatter={valueFormatter}
              />
            )}
            cursor={{
              fill: CHART_CURSOR_COLOR,
            }}
          />
        )}
        {legend && (
          <Legend
            formatter={legendFormatter}
            wrapperStyle={{
              color: CHART_TICK_COLOR,
              fontSize: 12,
              paddingTop: 16,
            }}
          />
        )}

        {bars.map((bar, index) => {
          const color =
            bar.color ?? CHART_PALETTE[index % CHART_PALETTE.length];
          const striped = (bar.pattern ?? pattern) === "stripes";
          const stackId =
            bar.stackId ?? (isPercent ? PERCENT_STACK_ID : undefined);
          return (
            <Bar
              animationBegin={animationBegin}
              dataKey={bar.dataKey}
              fill={color}
              key={bar.dataKey}
              name={bar.name ?? bar.dataKey}
              radius={
                bar.radius ??
                (stackId
                  ? 0
                  : [
                      4,
                      4,
                      0,
                      0,
                    ])
              }
              // The series keeps its flat `fill` (tooltip/legend swatches read
              // it); only the painted rectangle swaps in the pattern.
              shape={
                striped
                  ? (props: BarShapeProps) => (
                      <Rectangle
                        {...props}
                        fill={`url(#${uid}-${index})`}
                      />
                    )
                  : undefined
              }
              stackId={stackId}
              stroke={chartStroke(color)}
              strokeWidth={1}
              {...(animationDuration !== undefined && {
                animationDuration,
              })}
            />
          );
        })}
      </RechartsBarChart>
    </ChartContainer>
  );
}

// ─── Line ────────────────────────────────────────────────────────────────────

export interface ChartLineSeries {
  /** Key in each data object whose value determines the point's Y position. */
  dataKey: string;
  /** Human-readable label shown in the legend and tooltip. */
  name?: string;
  /** Stroke color; falls back to `CHART_PALETTE[index]` when omitted. */
  color?: string;
  /**
   * Stroke width in px.
   * @default 2
   */
  strokeWidth?: number;
  /**
   * Renders a dot at each data point.
   * @default true
   */
  dot?: boolean;
  /**
   * Curve interpolation; `"monotone"` avoids artificial inflection points.
   * @default "monotone"
   */
  type?: ChartCurveType;
  /** SVG `stroke-dasharray`, e.g. `"5 5"` for a dashed line. Omit for solid. */
  strokeDasharray?: string;
}

export interface ChartLineProps extends ChartContainerProps {
  /** Array of data objects. */
  data: Record<string, unknown>[];
  /** Key in each data object used as the X-axis category label. */
  xAxisKey: string;
  /** One entry per line series. */
  lines: ChartLineSeries[];
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend below the chart.
   * @default false
   */
  legend?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the X axis. */
  xAxisLabel?: string;
  /** Text label rendered left of the Y axis. */
  yAxisLabel?: string;
  /**
   * Bridges null/missing values by connecting the surrounding non-null
   * points instead of leaving a gap.
   * @default false
   */
  connectNulls?: boolean;
  /** Formats a raw numeric value for the tooltip/Y axis; receives the series' `dataKey`. */
  valueFormatter?: ChartValueFormatter;
}

/**
 * Line chart. One of the compound `Chart` types; see `Chart` itself for the
 * full set.
 * @example
 * ```tsx
 * <Chart.Line data={data} lines={[{ dataKey: "activeUsers" }]} xAxisKey="week" />
 * ```
 */
function ChartLine({
  data,
  xAxisKey,
  lines,
  size,
  height,
  tooltip = true,
  legend = false,
  grid = true,
  xAxisLabel,
  yAxisLabel,
  connectNulls = false,
  className,
  valueFormatter,
}: ChartLineProps) {
  return (
    <ChartContainer
      className={className}
      height={height}
      size={size}
    >
      <RechartsLineChart
        data={data}
        margin={chartMargin(xAxisLabel, yAxisLabel)}
      >
        {grid && (
          <CartesianGrid
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
          />
        )}

        <XAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          dataKey={xAxisKey}
          label={axisLabel(xAxisLabel, "insideBottom")}
          tick={TICK_STYLE}
          tickLine={false}
        />
        <YAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          label={axisLabel(yAxisLabel, "insideLeft")}
          tick={TICK_STYLE}
          tickLine={false}
        />

        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartSeriesTooltip
                {...props}
                valueFormatter={valueFormatter}
              />
            )}
          />
        )}
        {legend && (
          <Legend
            formatter={legendFormatter}
            wrapperStyle={{
              color: CHART_TICK_COLOR,
              fontSize: 12,
              paddingTop: 16,
            }}
          />
        )}

        {lines.map((line, index) => {
          // recharts paints dots white by default, which vanishes on the light
          // canvas and reads as a foreign white blob on the dark one — paint
          // them in the line's own color instead.
          const stroke =
            line.color ??
            chartStroke(CHART_PALETTE[index % CHART_PALETTE.length], 28);
          return (
            <Line
              activeDot={{
                fill: stroke,
                r: 5,
                stroke: "var(--background)",
                strokeWidth: 2,
              }}
              connectNulls={connectNulls}
              dataKey={line.dataKey}
              dot={
                line.dot !== false
                  ? {
                      fill: stroke,
                      r: 3,
                      stroke: "var(--background)",
                      strokeWidth: 1,
                    }
                  : false
              }
              key={line.dataKey}
              name={line.name ?? line.dataKey}
              stroke={stroke}
              strokeDasharray={line.strokeDasharray}
              strokeWidth={line.strokeWidth ?? 2}
              type={line.type ?? "monotone"}
            />
          );
        })}
      </RechartsLineChart>
    </ChartContainer>
  );
}

// ─── Donut ───────────────────────────────────────────────────────────────────

export interface ChartDonutSlice {
  /** Human-readable label shown in the legend and tooltip. */
  name: string;
  /** Numeric value that determines the slice's proportion. */
  value: number;
  /** Fill color; falls back to `CHART_PALETTE[index]` when omitted. */
  color?: string;
  /** Fill style for this slice; overrides the chart's `pattern`. */
  pattern?: ChartPattern;
}

export interface ChartDonutProps extends ChartContainerProps {
  /** One entry per slice. */
  data: ChartDonutSlice[];
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend below the chart.
   * @default true
   */
  legend?: boolean;
  /** Bold text rendered in the center of the donut, e.g. a total. */
  centerValue?: string;
  /** Small text rendered below `centerValue`. */
  centerLabel?: string;
  /**
   * Fill style for every slice that doesn't set its own `pattern`.
   * @default "solid"
   */
  pattern?: ChartPattern;
}

/**
 * Donut chart — proportions of a whole, with an optional total in the
 * center. One of the compound `Chart` types; see `Chart` itself for the
 * full set.
 * @example
 * ```tsx
 * <Chart.Donut centerLabel="Total" centerValue="1,204" data={data} />
 * ```
 */
function ChartDonut({
  data,
  size,
  height,
  tooltip = true,
  legend = true,
  centerValue,
  centerLabel,
  className,
  pattern = "solid",
}: ChartDonutProps) {
  const uid = useChartPatternId();
  return (
    <ChartContainer
      className={cn("relative", className)}
      height={height}
      size={size}
    >
      <RechartsPieChart>
        <defs>
          {data.map((slice, index) =>
            (slice.pattern ?? pattern) === "stripes" ? (
              <ChartStripePattern
                color={
                  slice.color ?? CHART_PALETTE[index % CHART_PALETTE.length]
                }
                id={`${uid}-${index}`}
                key={slice.name}
              />
            ) : null,
          )}
        </defs>
        <Pie
          data={withFill(data)}
          dataKey="value"
          innerRadius="62%"
          nameKey="name"
          outerRadius="85%"
          paddingAngle={2}
          shape={(props: PieSectorShapeProps) => {
            const slice = props.payload as ChartDonutSlice | undefined;
            const color =
              slice?.color ?? CHART_PALETTE[props.index % CHART_PALETTE.length];
            const striped = (slice?.pattern ?? pattern) === "stripes";
            return (
              <Sector
                {...props}
                fill={striped ? `url(#${uid}-${props.index})` : color}
                stroke={chartStroke(color)}
                strokeWidth={1}
              />
            );
          }}
          strokeWidth={0}
        />
        {tooltip && <Tooltip content={ChartSingleTooltip} />}
        {legend && (
          <Legend
            formatter={legendFormatter}
            wrapperStyle={{
              color: CHART_TICK_COLOR,
              fontSize: 12,
              paddingTop: 16,
            }}
          />
        )}
      </RechartsPieChart>
      {(centerValue !== undefined || centerLabel !== undefined) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue !== undefined && (
            <span className="font-primary text-xl font-bold text-foreground">
              {centerValue}
            </span>
          )}
          {centerLabel !== undefined && (
            <span className="font-primary text-xs text-muted-foreground">
              {centerLabel}
            </span>
          )}
        </div>
      )}
    </ChartContainer>
  );
}

// ─── Needle ──────────────────────────────────────────────────────────────────

export interface ChartNeedleSection {
  /** Human-readable label shown in the legend and tooltip, e.g. "Low". */
  name: string;
  /** Width of this range on the gauge, in the same unit as the needle's `value`. Sections are laid out left to right, so their values add up to the gauge's full scale. */
  value: number;
  /** Fill color; falls back to `CHART_PALETTE[index]` when omitted. Pass a semantic token (e.g. `"var(--success)"`) when a range genuinely means good/bad. */
  color?: string;
  /** Fill style for this range; overrides the chart's `pattern`. */
  pattern?: ChartPattern;
}

export interface ChartNeedleProps extends ChartContainerProps {
  /** Ranges that make up the gauge's scale, left to right. */
  data: ChartNeedleSection[];
  /** Where the needle points, on the scale defined by `data` (0 to the sum of the sections' values). Clamped to that range. */
  value: number;
  /**
   * Renders a tooltip when hovering a range.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend listing the ranges below the gauge.
   * @default true
   */
  legend?: boolean;
  /** Bold text rendered under the needle's hub, e.g. the reading. */
  centerValue?: string;
  /** Small text rendered below `centerValue`. */
  centerLabel?: string;
  /**
   * Fill style for every range that doesn't set its own `pattern`.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Accessible description of the gauge (the chart is exposed as a single image).
   * @default "`${value} of ${total}`"
   */
  "aria-label"?: string;
}

const NEEDLE_HUB_RADIUS = 6;
const NEEDLE_PADDING = 8;
const NEEDLE_LEGEND_HEIGHT = 32;
const NEEDLE_TEXT_HEIGHT = 48;

interface ChartNeedleGaugeProps {
  data: ChartNeedleSection[];
  pattern: ChartPattern;
  ratio: number;
  tooltip: boolean;
  bottomReserve: number;
}

/** Half-donut plus needle, sized from the chart's live dimensions so it stays fluid inside `ResponsiveContainer`. */
function ChartNeedleGauge({
  data,
  pattern,
  ratio,
  tooltip,
  bottomReserve,
}: ChartNeedleGaugeProps) {
  const width = useChartWidth();
  const height = useChartHeight();
  const uid = useChartPatternId();
  // Start the needle at 0 and sweep to the value on mount.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!width || !height) return null;

  const cx = width / 2;
  const cy = height - bottomReserve;
  const outerRadius = Math.max(0, Math.min(width / 2, cy) - NEEDLE_PADDING);
  const innerRadius = outerRadius * 0.62;
  const needleLength = Math.max(0, innerRadius - 4);

  return (
    <>
      <defs>
        {data.map((section, index) =>
          (section.pattern ?? pattern) === "stripes" ? (
            <ChartStripePattern
              color={
                section.color ?? CHART_PALETTE[index % CHART_PALETTE.length]
              }
              id={`${uid}-${index}`}
              key={section.name}
            />
          ) : null,
        )}
      </defs>
      <Pie
        cx={cx}
        cy={cy}
        data={withFill(data)}
        dataKey="value"
        endAngle={0}
        innerRadius={innerRadius}
        nameKey="name"
        outerRadius={outerRadius}
        paddingAngle={2}
        shape={(props: PieSectorShapeProps) => {
          const section = props.payload as ChartNeedleSection | undefined;
          const color =
            section?.color ?? CHART_PALETTE[props.index % CHART_PALETTE.length];
          const striped = (section?.pattern ?? pattern) === "stripes";
          return (
            <Sector
              {...props}
              fill={striped ? `url(#${uid}-${props.index})` : color}
              stroke={chartStroke(color)}
              strokeWidth={1}
            />
          );
        }}
        startAngle={180}
        strokeWidth={0}
      />
      {tooltip && <Tooltip content={ChartSingleTooltip} />}
      {/* Drawn pointing left (value 0) and rotated clockwise up to 180°. */}
      <g
        className="motion-reduce:transition-none"
        style={{
          pointerEvents: "none",
          transform: `rotate(${mounted ? ratio * 180 : 0}deg)`,
          transformOrigin: `${cx}px ${cy}px`,
          transition: "transform 700ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        <line
          stroke="var(--foreground)"
          strokeLinecap="round"
          strokeWidth={2}
          x1={cx}
          x2={cx - needleLength}
          y1={cy}
          y2={cy}
        />
      </g>
      <circle
        cx={cx}
        cy={cy}
        fill="var(--foreground)"
        pointerEvents="none"
        r={NEEDLE_HUB_RADIUS}
        stroke="var(--background)"
        strokeWidth={2}
      />
    </>
  );
}

/**
 * Gauge with a needle — a half donut of ranges (e.g. low / medium / high)
 * and a needle pointing at a reading. Adapted from `recharts`' "Pie chart with
 * needle". One of the compound `Chart` types; see `Chart` itself for the full
 * set.
 * @example
 * ```tsx
 * <Chart.Needle
 *   centerLabel="Health score"
 *   centerValue="72"
 *   data={[
 *     { color: "var(--destructive)", name: "Low", value: 40 },
 *     { color: "var(--warning)", name: "Medium", value: 30 },
 *     { color: "var(--success)", name: "High", value: 30 },
 *   ]}
 *   value={72}
 * />
 * ```
 */
function ChartNeedle({
  data,
  value,
  size,
  height,
  tooltip = true,
  legend = true,
  centerValue,
  centerLabel,
  className,
  pattern = "solid",
  "aria-label": ariaLabel,
}: ChartNeedleProps) {
  const total = data.reduce((sum, section) => sum + section.value, 0);
  const clamped = Math.min(Math.max(value, 0), total);
  const ratio = total > 0 ? clamped / total : 0;
  const hasCenter = centerValue !== undefined || centerLabel !== undefined;
  const legendHeight = legend ? NEEDLE_LEGEND_HEIGHT : 0;
  const textHeight = hasCenter ? NEEDLE_TEXT_HEIGHT : 0;
  // Room kept under the hub for the center text and the legend.
  const bottomReserve =
    legendHeight +
    (hasCenter ? textHeight : NEEDLE_HUB_RADIUS + NEEDLE_PADDING);

  return (
    <ChartContainer
      aria-label={ariaLabel ?? `${clamped} of ${total}`}
      className={cn("relative", className)}
      height={height}
      role="img"
      size={size}
    >
      <RechartsPieChart>
        <ChartNeedleGauge
          bottomReserve={bottomReserve}
          data={data}
          pattern={pattern}
          ratio={ratio}
          tooltip={tooltip}
        />
      </RechartsPieChart>
      {hasCenter && (
        <div
          className="pointer-events-none absolute inset-x-0 flex flex-col items-center pt-4"
          style={{
            bottom: legendHeight,
            height: textHeight,
          }}
        >
          {centerValue !== undefined && (
            <span className="font-primary text-xl font-bold leading-none text-foreground">
              {centerValue}
            </span>
          )}
          {centerLabel !== undefined && (
            <span className="mt-1 font-primary text-xs text-muted-foreground">
              {centerLabel}
            </span>
          )}
        </div>
      )}
      {legend && (
        <ul
          className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-primary text-xs text-muted-foreground"
          style={{
            minHeight: legendHeight,
          }}
        >
          {data.map((section, index) => (
            <li
              className="flex items-center gap-2"
              key={section.name}
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{
                  background:
                    section.color ??
                    CHART_PALETTE[index % CHART_PALETTE.length],
                }}
              />
              {section.name}
            </li>
          ))}
        </ul>
      )}
    </ChartContainer>
  );
}

// ─── Funnel ──────────────────────────────────────────────────────────────────

export interface ChartFunnelStage {
  /** Name of the stage, e.g. "Visited". */
  name: string;
  /** Number of items that reached this stage. Stages are listed from widest to narrowest. */
  value: number;
  /** Fill color; falls back to `CHART_PALETTE[index]` when omitted. */
  color?: string;
  /** Fill style for this stage; overrides the chart's `pattern`. */
  pattern?: ChartPattern;
}

export interface ChartFunnelProps extends ChartContainerProps {
  /** Stages from first (widest) to last (narrowest). */
  data: ChartFunnelStage[];
  /**
   * Fill style for every stage that doesn't set its own `pattern`.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Shows each stage's share of the first stage next to its value (e.g. `62%`), so drop-off reads directly.
   * @default true
   */
  showPercent?: boolean;
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /** Formats a stage's value in the labels. Defaults to a localized number. */
  valueFormatter?: (value: number) => string;
}

/**
 * Funnel chart — how a count shrinks stage by stage (visitors → sign-ups →
 * purchases). Each stage is labelled directly, beside its shape, with its
 * value and its share of the first stage. One of the compound `Chart` types;
 * see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Funnel
 *   data={[
 *     { name: "Visited", value: 12400 },
 *     { name: "Signed up", value: 4100 },
 *     { name: "Purchased", value: 980 },
 *   ]}
 * />
 * ```
 */
function ChartFunnel({
  data,
  pattern = "solid",
  showPercent = true,
  tooltip = true,
  valueFormatter,
  size,
  height,
  className,
}: ChartFunnelProps) {
  const uid = useChartPatternId();
  const first = data[0]?.value ?? 0;
  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString();

  return (
    <ChartContainer
      className={className}
      height={height}
      size={size}
    >
      <RechartsFunnelChart
        margin={{
          bottom: 8,
          left: 8,
          // Room for the direct labels beside the shapes.
          right: 168,
          top: 8,
        }}
      >
        <defs>
          {data.map((stage, index) =>
            (stage.pattern ?? pattern) === "stripes" ? (
              <ChartStripePattern
                color={
                  stage.color ?? CHART_PALETTE[index % CHART_PALETTE.length]
                }
                id={`${uid}-${index}`}
                key={stage.name}
              />
            ) : null,
          )}
        </defs>
        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartSingleTooltip
                {...props}
                valueFormatter={format}
              />
            )}
          />
        )}
        <Funnel
          data={withFill(data)}
          dataKey="value"
          lastShapeType="rectangle"
          nameKey="name"
          shape={(
            props: React.ComponentProps<typeof Trapezoid> & {
              name?: string;
            },
          ) => {
            // recharts doesn't pass the stage's index to a custom shape; the
            // stage name is what identifies it.
            const found = data.findIndex((item) => item.name === props.name);
            const index = found === -1 ? 0 : found;
            const stage = data[index];
            const color =
              stage?.color ?? CHART_PALETTE[index % CHART_PALETTE.length];
            const striped = (stage?.pattern ?? pattern) === "stripes";
            return (
              <Trapezoid
                {...props}
                fill={striped ? `url(#${uid}-${index})` : color}
                stroke={chartStroke(color)}
                strokeWidth={1}
              />
            );
          }}
        >
          <LabelList
            content={(props) => {
              const { x, y, width, height, index } = props as unknown as {
                x: number;
                y: number;
                width: number;
                height: number;
                index: number;
              };
              const stage = data[index];
              if (!stage) return null;
              const percent = first > 0 ? (stage.value / first) * 100 : 0;
              // Stage widths are proportional to their value and share a
              // center, so the widest stage's right edge — one shared column
              // for every label — follows from this stage's own box.
              const labelX =
                stage.value > 0
                  ? x + width / 2 + (width * first) / stage.value / 2 + 12
                  : x + width + 12;
              return (
                <g
                  style={{
                    pointerEvents: "none",
                  }}
                >
                  <text
                    dominantBaseline="middle"
                    fill="var(--foreground)"
                    fontFamily="var(--font-primary)"
                    fontSize={13}
                    fontWeight={600}
                    x={labelX}
                    y={y + height / 2 - 8}
                  >
                    {stage.name}
                  </text>
                  <text
                    dominantBaseline="middle"
                    fill="var(--muted-foreground)"
                    fontFamily="var(--font-primary)"
                    fontSize={12}
                    x={labelX}
                    y={y + height / 2 + 9}
                  >
                    {format(stage.value)}
                    {showPercent && ` · ${Math.round(percent)}%`}
                  </text>
                </g>
              );
            }}
            position="right"
          />
        </Funnel>
      </RechartsFunnelChart>
    </ChartContainer>
  );
}

// ─── Scatter ─────────────────────────────────────────────────────────────────

export interface ChartScatterSeries {
  /** Label shown in the legend. */
  name?: string;
  /** Data for this series; each object must have at least the keys referenced in `xKey`/`yKey`. */
  data: Record<string, unknown>[];
  /** Key in `data` used for the X position. */
  xKey: string;
  /** Key in `data` used for the Y position. */
  yKey: string;
  /** Key in `data` used to scale dot size (requires a Z-axis range); omit for uniformly-sized dots. */
  zKey?: string;
  /** Fill color; falls back to `CHART_PALETTE[index]` when omitted. */
  color?: string;
  /**
   * Dot opacity (0–1).
   * @default 0.85
   */
  opacity?: number;
}

export interface ChartScatterProps extends ChartContainerProps {
  /** One entry per scatter series (each with its own `data`). */
  series: ChartScatterSeries[];
  /** Label for the X axis (shared across all series). */
  xAxisLabel?: string;
  /** Label for the Y axis. */
  yAxisLabel?: string;
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend below the chart.
   * @default false
   */
  legend?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /**
   * `[min, max]` pixel size range for Z-axis (bubble size) scaling; only relevant when a series sets `zKey`.
   * @default [40, 400]
   */
  zRange?: [
    number,
    number,
  ];
}

function ChartScatterTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  const raw = point?.payload as Record<string, unknown> | undefined;

  return (
    <div className={tooltipClassName}>
      {point?.name && (
        <p className="mb-2 font-medium text-muted-foreground">
          {String(point.name)}
        </p>
      )}
      {raw &&
        Object.entries(raw).map(([key, val]) => (
          <div
            className="flex items-center gap-2"
            key={key}
          >
            <span className="font-medium">{key}:</span>
            <span>{String(val)}</span>
          </div>
        ))}
    </div>
  );
}

/**
 * Scatter/bubble chart. One of the compound `Chart` types; see `Chart`
 * itself for the full set.
 * @example
 * ```tsx
 * <Chart.Scatter series={[{ data, xKey: "weight", yKey: "height" }]} />
 * ```
 */
function ChartScatter({
  series,
  size,
  height,
  xAxisLabel,
  yAxisLabel,
  tooltip = true,
  legend = false,
  grid = true,
  zRange = [
    40,
    400,
  ],
  className,
}: ChartScatterProps) {
  const hasZAxis = series.some((s) => s.zKey !== undefined);

  return (
    <ChartContainer
      className={className}
      height={height}
      size={size}
    >
      <RechartsScatterChart margin={chartMargin(xAxisLabel, yAxisLabel)}>
        {grid && (
          <CartesianGrid
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
          />
        )}

        <XAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          dataKey={series[0]?.xKey ?? "x"}
          label={axisLabel(xAxisLabel, "insideBottom")}
          name={xAxisLabel}
          tick={TICK_STYLE}
          tickLine={false}
          type="number"
        />
        <YAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          dataKey={series[0]?.yKey ?? "y"}
          label={axisLabel(yAxisLabel, "insideLeft")}
          name={yAxisLabel}
          tick={TICK_STYLE}
          tickLine={false}
          type="number"
        />

        {hasZAxis && (
          <ZAxis
            range={zRange}
            type="number"
          />
        )}

        {tooltip && (
          <Tooltip
            content={ChartScatterTooltip}
            cursor={{
              strokeDasharray: "3 3",
            }}
          />
        )}
        {legend && (
          <Legend
            formatter={legendFormatter}
            wrapperStyle={{
              color: CHART_TICK_COLOR,
              fontSize: 12,
              paddingTop: 16,
            }}
          />
        )}

        {series.map((s, index) => (
          <Scatter
            data={s.data}
            fill={s.color ?? CHART_PALETTE[index % CHART_PALETTE.length]}
            fillOpacity={s.opacity ?? 0.85}
            key={s.name ?? index}
            name={s.name}
            stroke={chartStroke(
              s.color ?? CHART_PALETTE[index % CHART_PALETTE.length],
            )}
            strokeWidth={1}
          />
        ))}
      </RechartsScatterChart>
    </ChartContainer>
  );
}

// ─── Radar ───────────────────────────────────────────────────────────────────

export interface ChartRadarSeries {
  /** Key in each data object whose value sets this series' distance from the center on every spoke. */
  dataKey: string;
  /** Human-readable label shown in the legend and tooltip. */
  name?: string;
  /** Stroke/fill color; falls back to `CHART_PALETTE[index]` when omitted. */
  color?: string;
  /**
   * Opacity of the filled polygon (0–1). Kept low so overlapping series stay readable. Ignored when the
   * resolved `pattern` is `"stripes"`.
   * @default 0.2
   */
  fillOpacity?: number;
  /**
   * Outline width in px.
   * @default 2
   */
  strokeWidth?: number;
  /**
   * Draws a dot at each spoke, for reading individual vertices off a sparse shape.
   * @default false
   */
  dot?: boolean;
  /** Fill style for this series; overrides the chart's `pattern`. */
  pattern?: ChartPattern;
}

export interface ChartRadarProps extends ChartContainerProps {
  /** Array of data objects — one per spoke, each holding every series' value for that spoke. */
  data: Record<string, unknown>[];
  /** Key in each data object used as the spoke's label around the outside. */
  axisKey: string;
  /** One entry per series (the polygons drawn on top of each other). */
  radars: ChartRadarSeries[];
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend below the chart. Worth turning on from two series up.
   * @default false
   */
  legend?: boolean;
  /**
   * Renders the web of grid lines behind the shapes.
   * @default true
   */
  grid?: boolean;
  /**
   * Shape of that web: straight lines between spokes, or concentric circles.
   * @default "polygon"
   */
  gridShape?: "circle" | "polygon";
  /**
   * Labels the radial scale (the numbers from center to edge). Off by default — on a radar the shape carries
   * the comparison and the tooltip carries the numbers, so the ticks usually just crowd the middle.
   * @default false
   */
  radiusAxis?: boolean;
  /** `[min, max]` for the radial scale. Omit to fit the data; pass an explicit range (e.g. `[0, 100]`) when the scale is a known one, so shapes stay comparable across charts. */
  domain?: [
    number,
    number,
  ];
  /** Formats a raw numeric value for the tooltip (and for the radial ticks when `radiusAxis` is on); receives the series' `dataKey`. */
  valueFormatter?: ChartValueFormatter;
  /**
   * Fill style for every series that doesn't set its own `pattern`.
   * @default "solid"
   */
  pattern?: ChartPattern;
}

/**
 * Radar chart — one entity's profile across several axes at once (a skills
 * matrix, a scorecard, a feature comparison), with a polygon per series so
 * their shapes can be read against each other. Axes are categories, not a
 * continuum: order them deliberately, since the shape depends on it. One of the
 * compound `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Radar
 *   axisKey="skill"
 *   data={[{ skill: "React", now: 8, target: 9 }]}
 *   radars={[{ dataKey: "now" }, { dataKey: "target" }]}
 * />
 * ```
 */
function ChartRadar({
  data,
  axisKey,
  radars,
  size,
  height,
  tooltip = true,
  legend = false,
  grid = true,
  gridShape = "polygon",
  radiusAxis = false,
  domain,
  valueFormatter,
  className,
  pattern = "solid",
}: ChartRadarProps) {
  const uid = useChartPatternId();
  const firstKey = radars[0]?.dataKey ?? "";

  return (
    <ChartContainer
      className={className}
      height={height}
      size={size}
    >
      <RechartsRadarChart
        data={data}
        // Leaves room for the spoke labels around the outside.
        outerRadius="72%"
      >
        <defs>
          {radars.map((radar, index) =>
            (radar.pattern ?? pattern) === "stripes" ? (
              <ChartStripePattern
                color={
                  radar.color ?? CHART_PALETTE[index % CHART_PALETTE.length]
                }
                id={`${uid}-${index}`}
                key={radar.dataKey}
                opacity={0.35}
              />
            ) : null,
          )}
        </defs>
        {grid && (
          <PolarGrid
            gridType={gridShape}
            stroke={CHART_GRID_COLOR}
          />
        )}
        <PolarAngleAxis
          dataKey={axisKey}
          tick={TICK_STYLE}
        />
        <PolarRadiusAxis
          angle={90}
          axisLine={false}
          domain={domain}
          tick={radiusAxis ? TICK_STYLE : false}
          tickFormatter={
            valueFormatter
              ? (value) => valueFormatter(value, firstKey)
              : undefined
          }
        />
        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartSeriesTooltip
                {...props}
                valueFormatter={valueFormatter}
              />
            )}
          />
        )}
        {legend && (
          <Legend
            formatter={legendFormatter}
            wrapperStyle={{
              color: CHART_TICK_COLOR,
              fontSize: 12,
              paddingTop: 16,
            }}
          />
        )}
        {radars.map((radar, index) => {
          const color =
            radar.color ?? CHART_PALETTE[index % CHART_PALETTE.length];
          const line = radar.color ?? chartStroke(color);
          const striped = (radar.pattern ?? pattern) === "stripes";
          return (
            <Radar
              dataKey={radar.dataKey}
              dot={
                radar.dot
                  ? {
                      fill: line,
                      r: 3,
                      stroke: "var(--background)",
                      strokeWidth: 1,
                    }
                  : false
              }
              fill={striped ? `url(#${uid}-${index})` : color}
              fillOpacity={striped ? 1 : (radar.fillOpacity ?? 0.2)}
              key={radar.dataKey}
              name={radar.name ?? radar.dataKey}
              stroke={line}
              strokeWidth={radar.strokeWidth ?? 2}
            />
          );
        })}
      </RechartsRadarChart>
    </ChartContainer>
  );
}

// ─── Sankey ──────────────────────────────────────────────────────────────────

/** A stage in a `Chart.Sankey`, addressed by `id` from the links. */
export type ChartSankeyNode = SankeyNodeInput;

/** A flow between two `Chart.Sankey` nodes. */
export type ChartSankeyLink = SankeyLinkInput;

export interface ChartSankeyProps extends ChartContainerProps {
  /** Every stage in the flow. Order sets the palette rotation; the columns come from the links. */
  nodes: ChartSankeyNode[];
  /** The flows between them. A link naming an unknown node, pointing a node at itself, carrying a non-positive value, or closing a loop is left out — a Sankey diagram is only defined on an acyclic graph. */
  links: ChartSankeyLink[];
  /**
   * Thickness of the node bars in px.
   * @default 12
   */
  nodeWidth?: number;
  /**
   * Vertical gap between nodes in the same column, in px.
   * @default 16
   */
  nodePadding?: number;
  /**
   * Opacity of the flow ribbons (0–1). Low enough that crossing flows stay readable; the hovered one lifts
   * above it.
   * @default 0.35
   */
  linkOpacity?: number;
  /**
   * Labels each node directly, beside or above its bar, instead of relying on the tooltip alone.
   * @default true
   */
  labels?: boolean;
  /**
   * Horizontal room reserved for the labels of the first and last columns, in px. Raise it for long names.
   * @default 96
   */
  labelGutter?: number;
  /**
   * Renders a tooltip on hover, over a node or a flow.
   * @default true
   */
  tooltip?: boolean;
  /** Formats a flow's value in the tooltip and the direct labels. Defaults to a localized number. */
  valueFormatter?: (value: number) => string;
  /**
   * Accessible description of the chart (it's exposed as a single image).
   * @default "`Sankey diagram of N stages and M flows`"
   */
  "aria-label"?: string;
}

/** Tooltip for a `Chart.Sankey`: a flow reads `source → target`, a node reads its own name and total. */
function ChartSankeyTooltip({
  active,
  payload,
  valueFormatter,
}: TooltipContentProps & {
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry) return null;
  const item = entry.payload as
    | {
        name?: string;
        value?: number;
        color?: string;
        source?: {
          name?: string;
        };
        target?: {
          name?: string;
        };
      }
    | undefined;
  if (!item) return null;

  const value = Number(entry.value ?? item.value);
  // Only a link carries both ends; a node carries its own name.
  const label =
    item.source?.name !== undefined && item.target?.name !== undefined
      ? `${item.source.name} → ${item.target.name}`
      : (item.name ?? "");

  return (
    <div className={tooltipClassName}>
      <div className="flex items-center gap-2">
        {item.color !== undefined && (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{
              background: item.color,
            }}
          />
        )}
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          {valueFormatter ? valueFormatter(value) : value.toLocaleString()}
        </span>
      </div>
    </div>
  );
}

/**
 * Sankey diagram — where a quantity comes from and where it goes, with each
 * ribbon's thickness proportional to its flow. Unlike `Chart.Funnel`, which
 * only models a single chain shrinking stage by stage, a Sankey splits and
 * merges. Nodes are addressed by a readable `id` rather than by array index.
 * One of the compound `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Sankey
 *   links={[{ source: "visit", target: "signup", value: 1200 }]}
 *   nodes={[{ id: "visit", name: "Visited" }, { id: "signup", name: "Signed up" }]}
 * />
 * ```
 */
function ChartSankey({
  nodes,
  links,
  size,
  height,
  nodeWidth = 12,
  nodePadding = 16,
  linkOpacity = 0.35,
  labels = true,
  labelGutter = 96,
  tooltip = true,
  valueFormatter,
  className,
  "aria-label": ariaLabel,
}: ChartSankeyProps) {
  const [active, setActive] = React.useState<{
    type: "link" | "node";
    index: number;
  } | null>(null);
  const resolved = React.useMemo(
    () => toSankeyData(nodes, links, CHART_PALETTE),
    [
      nodes,
      links,
    ],
  );

  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString();

  // With no flow left there are no columns to lay out, so there's no diagram.
  if (resolved.links.length === 0) return null;

  return (
    <ChartContainer
      aria-label={
        ariaLabel ??
        `Sankey diagram of ${resolved.nodes.length} stages and ${resolved.links.length} flows`
      }
      className={className}
      height={height}
      role="img"
      size={size}
    >
      <Sankey
        data={resolved}
        link={(props: SankeyLinkProps) => {
          const {
            sourceX,
            sourceY,
            sourceControlX,
            targetControlX,
            targetX,
            targetY,
            linkWidth,
            index,
          } = props;
          const hovered = active?.type === "link" && active.index === index;
          return (
            <path
              d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
              fill="none"
              stroke={resolved.links[index]?.color ?? CHART_PALETTE[0]}
              strokeOpacity={
                hovered ? Math.min(1, linkOpacity + 0.3) : linkOpacity
              }
              strokeWidth={Math.max(1, linkWidth)}
            />
          );
        }}
        margin={{
          bottom: 8,
          left: labels ? labelGutter : 8,
          right: labels ? labelGutter : 8,
          top: 20,
        }}
        node={(props: SankeyNodeProps) => {
          const { x, y, width, height: nodeHeight, index, payload } = props;
          const node = resolved.nodes[index];
          const color = node?.color ?? CHART_PALETTE[0];
          const entry = payload.sourceLinks.length === 0;
          const start = payload.targetLinks.length === 0;
          return (
            <g>
              <rect
                fill={color}
                height={nodeHeight}
                rx={2}
                stroke={chartStroke(color)}
                strokeWidth={1}
                width={width}
                x={x}
                y={y}
              />
              {labels && (
                <text
                  className="font-primary"
                  // The first and last columns label outward, into the gutter;
                  // the ones in between sit above their bar, clear of the
                  // ribbons crossing on both sides.
                  dominantBaseline={start || entry ? "middle" : "auto"}
                  fill="var(--foreground)"
                  fontSize={12}
                  fontWeight={500}
                  textAnchor={start ? "end" : entry ? "start" : "middle"}
                  x={start ? x - 8 : entry ? x + width + 8 : x + width / 2}
                  y={start || entry ? y + nodeHeight / 2 : y - 6}
                >
                  {payload.name}
                  {(start || entry) && (
                    <tspan
                      fill={CHART_TICK_COLOR}
                      fontWeight={400}
                    >
                      {` ${format(Number(payload.value))}`}
                    </tspan>
                  )}
                </text>
              )}
            </g>
          );
        }}
        nodePadding={nodePadding}
        nodeWidth={nodeWidth}
        onMouseEnter={(item, type) =>
          setActive({
            index: item.index,
            type,
          })
        }
        onMouseLeave={() => setActive(null)}
      >
        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartSankeyTooltip
                {...props}
                valueFormatter={valueFormatter}
              />
            )}
          />
        )}
      </Sankey>
    </ChartContainer>
  );
}

// ─── TreeMap ─────────────────────────────────────────────────────────────────

export interface ChartTreeMapItem {
  /** Node label rendered inside the rectangle. */
  name: string;
  /** Numeric value determining the rectangle's relative area; required for leaf nodes. */
  value?: number;
  /** Child nodes — providing these produces a nested treemap. */
  children?: ChartTreeMapItem[];
  [key: string]: unknown;
}

export interface ChartTreeMapProps extends ChartContainerProps {
  /** Hierarchical data — see `ChartTreeMapItem` for the shape. */
  data: ChartTreeMapItem[];
  /**
   * Key in each data item used to derive rectangle size.
   * @default "value"
   */
  dataKey?: string;
  /**
   * Key in each data item used as the label.
   * @default "name"
   */
  nameKey?: string;
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /** Color palette applied to rectangles in order. Falls back to `CHART_PALETTE`. */
  colors?: readonly string[];
  /**
   * Gap (px) between sibling rectangles at the same depth.
   * @default 2
   */
  nodeGap?: number;
  /**
   * Inset (px) between a parent rectangle and its child rectangles; only meaningful for nested data.
   * @default 4
   */
  nodeInset?: number;
  /**
   * `"flat"` renders all leaf nodes at a single level; `"nest"` allows interactive drill-down.
   * @default "flat"
   */
  type?: "flat" | "nest";
  /**
   * Target aspect ratio for each rectangle; the golden ratio produces balanced tiles.
   * @default 1.618033988749895
   */
  aspectRatio?: number;
  /**
   * Fill style of the leaf rectangles.
   * @default "solid"
   */
  pattern?: ChartPattern;
}

interface ChartTreeMapCellProps extends TreemapNode {
  colors: readonly string[];
  pattern: ChartPattern;
  patternId: string;
}

function ChartTreeMapCell({
  x,
  y,
  width,
  height,
  name,
  value,
  depth,
  index,
  colors,
  pattern,
  patternId,
}: ChartTreeMapCellProps) {
  const isLeaf = depth > 0;
  const color = colors[index % colors.length] ?? CHART_PALETTE[0];
  const opacity = depth === 1 ? 1 : 0.75;
  const MIN_LABEL_WIDTH = 40;
  const MIN_LABEL_HEIGHT = 24;
  const striped = isLeaf && pattern === "stripes";

  return (
    <g>
      {striped && (
        <defs>
          <ChartStripePattern
            color={color}
            id={`${patternId}-${index}`}
          />
        </defs>
      )}
      <rect
        fill={
          striped
            ? `url(#${patternId}-${index})`
            : isLeaf
              ? color
              : "transparent"
        }
        fillOpacity={opacity}
        height={height}
        stroke="var(--background)"
        strokeWidth={1}
        style={{
          transition: "fill-opacity 200ms ease",
        }}
        width={width}
        x={x}
        y={y}
      />
      {isLeaf && width > MIN_LABEL_WIDTH && height > MIN_LABEL_HEIGHT && (
        <>
          <text
            dominantBaseline="middle"
            fill={CHART_LABEL_ON_FILL_COLOR}
            fontFamily="var(--font-primary)"
            fontSize={Math.min(12, width / 6)}
            fontWeight={600}
            style={{
              pointerEvents: "none",
              userSelect: "none",
            }}
            textAnchor="middle"
            x={x + width / 2}
            y={y + height / 2 - (value !== undefined ? 8 : 0)}
          >
            {name}
          </text>
          {value !== undefined && (
            <text
              dominantBaseline="middle"
              fill={CHART_LABEL_ON_FILL_COLOR}
              fillOpacity={0.75}
              fontFamily="var(--font-primary)"
              fontSize={Math.min(10, width / 8)}
              style={{
                pointerEvents: "none",
                userSelect: "none",
              }}
              textAnchor="middle"
              x={x + width / 2}
              y={y + height / 2 + 10}
            >
              {value}
            </text>
          )}
        </>
      )}
    </g>
  );
}

function ChartTreeMapTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  const raw = entry?.payload as Record<string, unknown> | undefined;
  const name = raw?.name ?? entry?.name;
  const value = raw?.value ?? entry?.value;

  return (
    <div className={tooltipClassName}>
      {name !== undefined && (
        <p className="mb-1 font-semibold">{String(name)}</p>
      )}
      {value !== undefined && (
        <p className="text-muted-foreground">{String(value)}</p>
      )}
    </div>
  );
}

/**
 * Treemap — nested rectangles sized by value, for proportions within a
 * hierarchy. One of the compound `Chart` types; see `Chart` itself for the
 * full set.
 * @example
 * ```tsx
 * <Chart.TreeMap data={data} />
 * ```
 */
function ChartTreeMap({
  data,
  dataKey = "value",
  nameKey = "name",
  size,
  height,
  tooltip = true,
  colors = CHART_PALETTE,
  nodeGap = 2,
  nodeInset = 4,
  type = "flat",
  aspectRatio = 1.618033988749895,
  className,
  pattern = "solid",
}: ChartTreeMapProps) {
  const patternId = useChartPatternId();
  return (
    <ChartContainer
      className={className}
      height={height}
      size={size}
    >
      <Treemap
        aspectRatio={aspectRatio}
        colorPanel={colors as string[]}
        content={(node: TreemapNode) => (
          <ChartTreeMapCell
            {...node}
            colors={colors}
            pattern={pattern}
            patternId={patternId}
          />
        )}
        data={data}
        dataKey={dataKey}
        nameKey={nameKey}
        nodeGap={nodeGap}
        nodeInset={nodeInset}
        type={type}
      >
        {tooltip && <Tooltip content={ChartTreeMapTooltip} />}
      </Treemap>
    </ChartContainer>
  );
}

// ─── Shared: custom-drawn glyph charts ───────────────────────────────────────

/** Rounds `[lo, hi]` outward to "nice" tick boundaries, with a little headroom, and returns the evenly spaced ticks between them — for charts drawn by hand, where recharts can't infer a domain from series it doesn't know (and would pick uneven ticks for a custom one). */
function niceAxis(
  lo: number,
  hi: number,
): {
  domain: [
    number,
    number,
  ];
  ticks: number[];
} {
  if (lo === hi)
    return {
      domain: [
        lo - 1,
        hi + 1,
      ],
      ticks: [
        lo - 1,
        lo,
        hi + 1,
      ],
    };
  const target = (hi - lo) / 5;
  const power = 10 ** Math.floor(Math.log10(target));
  const fraction = target / power;
  const step =
    (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  const pad = (hi - lo) * 0.04;
  const start = Math.floor((lo - pad) / step) * step;
  const end = Math.ceil((hi + pad) / step) * step;
  const ticks: number[] = [];
  // Rounded to dodge float noise such as 0.30000000000000004.
  for (let value = start; value <= end + step / 2; value += step)
    ticks.push(Number(value.toFixed(10)));
  return {
    domain: [
      start,
      end,
    ],
    ticks,
  };
}

interface ChartGlyphGeometry {
  /** X of the middle of the category's band. */
  center: number;
  /** Width of the category's band. */
  band: number;
  /** Converts a data value to its Y pixel. */
  y: (value: number) => number;
}

interface ChartGlyphLayerProps<T> {
  data: T[];
  /** Key in each datum holding the category label. */
  xAxisKey: keyof T & string;
  /** Draws one datum (SVG) given where its band sits. */
  render: (
    datum: T,
    geometry: ChartGlyphGeometry,
    index: number,
  ) => React.ReactNode;
}

/** Runs inside a recharts chart and draws one hand-built glyph (box, candle…) per category, positioned with the chart's own axis scales so it stays aligned with the grid, ticks and tooltip cursor. */
function ChartGlyphLayer<T>({
  data,
  xAxisKey,
  render,
}: ChartGlyphLayerProps<T>) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot || data.length === 0) return null;
  // The category scale returns the *start* of a band and doesn't expose its
  // width, but bands split the plot area evenly.
  const band = plot.width / data.length;

  return (
    <g>
      {data.map((datum, index) => {
        const start = xScale(datum[xAxisKey] as string);
        if (start === undefined || Number.isNaN(start)) return null;
        return (
          <g
            data-chart-glyph=""
            // biome-ignore lint/suspicious/noArrayIndexKey: glyphs are positional, one per datum.
            key={index}
            style={{
              pointerEvents: "none",
            }}
          >
            {render(
              datum,
              {
                band,
                center: start + band / 2,
                y: (value) => yScale(value) ?? 0,
              },
              index,
            )}
          </g>
        );
      })}
    </g>
  );
}

// ─── Positive / negative bar ─────────────────────────────────────────────────

export interface ChartPositiveNegativeProps extends ChartContainerProps {
  /** Array of data objects. */
  data: Record<string, unknown>[];
  /** Key in each data object used as the category (X-axis) label. */
  xAxisKey: string;
  /** Key in each data object holding the signed value: bars above zero use `positiveColor`, bars below use `negativeColor`. */
  dataKey: string;
  /** Human-readable name of the value, shown in the tooltip. Defaults to `dataKey`. */
  name?: string;
  /**
   * Color of bars at or above zero.
   * @default CHART_COLORS.green
   */
  positiveColor?: string;
  /**
   * Color of bars below zero.
   * @default CHART_COLORS.rose
   */
  negativeColor?: string;
  /**
   * Fill style of the bars.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the X axis. */
  xAxisLabel?: string;
  /** Text label rendered left of the Y axis. */
  yAxisLabel?: string;
  /** Formats a raw numeric value for the tooltip. */
  valueFormatter?: ChartValueFormatter;
}

/**
 * Bar chart for values that swing around zero (profit and loss, change vs.
 * last period): bars grow up from a zero line when positive and down when
 * negative, each sign in its own color. One of the compound `Chart` types;
 * see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.PositiveNegative data={monthly} dataKey="profit" xAxisKey="month" />
 * ```
 */
function ChartPositiveNegative({
  data,
  xAxisKey,
  dataKey,
  name,
  positiveColor = CHART_COLORS.green,
  negativeColor = CHART_COLORS.rose,
  pattern = "solid",
  size,
  height,
  tooltip = true,
  grid = true,
  xAxisLabel,
  yAxisLabel,
  valueFormatter,
  className,
}: ChartPositiveNegativeProps) {
  const uid = useChartPatternId();
  const striped = pattern === "stripes";
  const colorOf = (value: number) =>
    value < 0 ? negativeColor : positiveColor;

  return (
    <ChartContainer
      className={className}
      height={height}
      size={size}
    >
      <RechartsBarChart
        data={data}
        margin={chartMargin(xAxisLabel, yAxisLabel)}
      >
        <defs>
          {striped && (
            <>
              <ChartStripePattern
                color={positiveColor}
                id={`${uid}-pos`}
              />
              <ChartStripePattern
                color={negativeColor}
                id={`${uid}-neg`}
              />
            </>
          )}
        </defs>
        {grid && (
          <CartesianGrid
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
            vertical={false}
          />
        )}
        <XAxis
          axisLine={false}
          dataKey={xAxisKey}
          label={axisLabel(xAxisLabel, "insideBottom")}
          tick={TICK_STYLE}
          tickLine={false}
          // Labels sit at the bottom, clear of the bars that hang below zero.
          tickMargin={8}
        />
        <YAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          label={axisLabel(yAxisLabel, "insideLeft")}
          tick={TICK_STYLE}
          tickLine={false}
        />
        <ReferenceLine
          stroke="var(--foreground-tertiary)"
          y={0}
        />
        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartPositiveNegativeTooltip
                {...props}
                negativeColor={negativeColor}
                positiveColor={positiveColor}
                valueFormatter={valueFormatter}
              />
            )}
            cursor={{
              fill: CHART_CURSOR_COLOR,
            }}
          />
        )}
        <Bar
          dataKey={dataKey}
          fill={positiveColor}
          name={name ?? dataKey}
          radius={[
            4,
            4,
            0,
            0,
          ]}
          shape={(props: BarShapeProps) => {
            const value = Number(
              (props.payload as Record<string, unknown> | undefined)?.[dataKey],
            );
            const negative = value < 0;
            return (
              <Rectangle
                {...props}
                fill={
                  striped
                    ? `url(#${uid}-${negative ? "neg" : "pos"})`
                    : colorOf(value)
                }
                stroke={chartStroke(colorOf(value))}
                strokeWidth={1}
              />
            );
          }}
        />
      </RechartsBarChart>
    </ChartContainer>
  );
}

function ChartPositiveNegativeTooltip({
  active,
  payload,
  label,
  valueFormatter,
  positiveColor,
  negativeColor,
}: TooltipContentProps & {
  valueFormatter?: ChartValueFormatter;
  positiveColor: string;
  negativeColor: string;
}) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry) return null;
  const value = Number(entry.value);

  return (
    <div className={tooltipClassName}>
      {label !== undefined && (
        <p className="mb-2 font-medium text-muted-foreground">{label}</p>
      )}
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{
            background: value < 0 ? negativeColor : positiveColor,
          }}
        />
        <span className="font-medium">
          {String(entry.name ?? entry.dataKey)}:
        </span>
        <span>
          {valueFormatter
            ? valueFormatter(value, String(entry.dataKey))
            : String(entry.value)}
        </span>
      </div>
    </div>
  );
}

// ─── Waterfall ───────────────────────────────────────────────────────────────

export interface ChartWaterfallProps extends ChartContainerProps {
  /** The steps of the bridge, in order. A `kind: "total"` step is an absolute anchor (an opening balance or a subtotal) that also resets the running total. */
  steps: WaterfallStepInput[];
  /** Appends a closing anchor bar with this label, from zero to the final total. Omit to end on the last delta. */
  total?: string;
  /**
   * Color of the bars that add.
   * @default CHART_COLORS.green
   */
  increaseColor?: string;
  /**
   * Color of the bars that subtract.
   * @default CHART_COLORS.rose
   */
  decreaseColor?: string;
  /**
   * Color of the anchor bars (opening balance, subtotals, closing total).
   * @default CHART_COLORS.blue
   */
  totalColor?: string;
  /**
   * Fill style of the bars.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Bar width as a fraction of its category band (0–1). The rest is the gap the connectors cross.
   * @default 0.6
   */
  barWidth?: number;
  /**
   * Labels each bar with its signed contribution (an anchor with its level), which is how a bridge is usually
   * read — the axis is there for scale, not for looking values up.
   * @default true
   */
  labels?: boolean;
  /**
   * Draws the thin connectors from one bar's tip to the next bar's base, so the chain reads as continuous.
   * @default true
   */
  connectors?: boolean;
  /**
   * Renders a tooltip with the step's contribution and the running total.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the X axis. */
  xAxisLabel?: string;
  /** Text label rendered left of the Y axis. */
  yAxisLabel?: string;
  /** Formats a value for the labels, axis and tooltip. Defaults to a localized number. */
  valueFormatter?: (value: number) => string;
  /**
   * Accessible description of the chart (it's exposed as a single image).
   * @default "`Waterfall chart of N steps`"
   */
  "aria-label"?: string;
}

/** Tooltip for a `Chart.Waterfall`: what the step contributed, and where the running total stands after it. */
function ChartWaterfallTooltip({
  active,
  payload,
  valueFormatter,
}: TooltipContentProps & {
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const step = payload[0]?.payload as WaterfallStep | undefined;
  if (!step) return null;
  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString();

  return (
    <div className={tooltipClassName}>
      <p className="mb-2 font-medium text-muted-foreground">{step.name}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
        {step.kind === "delta" && (
          <div className="col-span-2 grid grid-cols-subgrid">
            <dt className="font-medium">Change</dt>
            <dd className="text-right tabular-nums">
              {step.delta > 0 ? "+" : ""}
              {format(step.delta)}
            </dd>
          </div>
        )}
        <div className="col-span-2 grid grid-cols-subgrid">
          <dt className="font-medium">
            {step.kind === "total" ? "Level" : "Running total"}
          </dt>
          <dd className="text-right tabular-nums">{format(step.cumulative)}</dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Waterfall (bridge) chart — how a starting figure becomes an ending one, one
 * signed contribution at a time, with each bar floating where the previous one
 * ended. Where `Chart.PositiveNegative` shows independent signed values per
 * category, a waterfall shows a *chain*: the running total is the subject.
 * `recharts` has no waterfall, so the bars and connectors are drawn by hand on
 * its scales. One of the compound `Chart` types; see `Chart` itself for the
 * full set.
 * @example
 * ```tsx
 * <Chart.Waterfall
 *   steps={[
 *     { kind: "total", name: "Q1", value: 100 },
 *     { name: "New business", value: 40 },
 *     { name: "Churn", value: -25 },
 *   ]}
 *   total="Q2"
 * />
 * ```
 */
function ChartWaterfall({
  steps,
  total,
  increaseColor = CHART_COLORS.green,
  decreaseColor = CHART_COLORS.rose,
  totalColor = CHART_COLORS.blue,
  pattern = "solid",
  barWidth = 0.6,
  labels = true,
  connectors = true,
  size,
  height,
  tooltip = true,
  grid = true,
  xAxisLabel,
  yAxisLabel,
  valueFormatter,
  className,
  "aria-label": ariaLabel,
}: ChartWaterfallProps) {
  const uid = useChartPatternId();
  const { steps: bars, domain } = React.useMemo(
    () =>
      buildWaterfall(steps, {
        total,
      }),
    [
      steps,
      total,
    ],
  );

  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString();
  const colorOf = (step: WaterfallStep) =>
    step.color ??
    (step.direction === "total"
      ? totalColor
      : step.direction === "down"
        ? decreaseColor
        : increaseColor);

  // No steps means no chain to bridge, so there's nothing to draw.
  if (bars.length === 0) return null;

  // A bridge that stays at or above zero keeps its baseline on the axis; one
  // that dips below needs the axis padded on both sides.
  const valueAxis =
    domain[0] >= 0 ? zeroBasedAxis(domain[1]) : niceAxis(domain[0], domain[1]);
  const striped = pattern === "stripes";

  return (
    <ChartContainer
      aria-label={ariaLabel ?? `Waterfall chart of ${bars.length} steps`}
      className={className}
      height={height}
      role="img"
      size={size}
    >
      <RechartsBarChart
        data={bars}
        margin={chartMargin(xAxisLabel, yAxisLabel)}
      >
        <defs>
          {striped &&
            [
              increaseColor,
              decreaseColor,
              totalColor,
            ].map((color, index) => (
              <ChartStripePattern
                color={color}
                id={`${uid}-${index}`}
                key={color}
              />
            ))}
        </defs>
        {grid && (
          <CartesianGrid
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
            vertical={false}
          />
        )}
        <XAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          // Keyed by index, labelled by name: a bridge may repeat a label, and
          // a category axis can't tell two identical values apart.
          dataKey="key"
          label={axisLabel(xAxisLabel, "insideBottom")}
          tick={TICK_STYLE}
          tickFormatter={(_value, index) => bars[index]?.name ?? ""}
          tickLine={false}
        />
        <YAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          domain={valueAxis.domain}
          label={axisLabel(yAxisLabel, "insideLeft")}
          tick={TICK_STYLE}
          tickFormatter={format}
          tickLine={false}
          ticks={valueAxis.ticks}
        />
        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartWaterfallTooltip
                {...props}
                valueFormatter={valueFormatter}
              />
            )}
            cursor={{
              fill: CHART_CURSOR_COLOR,
            }}
          />
        )}
        {/* Invisible series: gives recharts a band per step to hover and a payload for the tooltip. */}
        <Bar
          dataKey="to"
          fill="transparent"
          isAnimationActive={false}
          legendType="none"
          stroke="none"
        />
        {/* Zero line, the baseline every floating bar is measured against. */}
        <ReferenceLine
          stroke={CHART_AXIS_COLOR}
          y={0}
        />
        <ChartGlyphLayer
          data={bars}
          render={(step, { center, band, y }, index) => {
            const color = colorOf(step);
            const width = Math.max(4, band * barWidth);
            const top = Math.min(y(step.from), y(step.to));
            const bottom = Math.max(y(step.from), y(step.to));
            const previous = bars[index - 1];
            const patternIndex =
              step.direction === "total"
                ? 2
                : step.direction === "down"
                  ? 1
                  : 0;
            const label =
              step.kind === "total"
                ? format(step.cumulative)
                : `${step.delta > 0 ? "+" : ""}${format(step.delta)}`;
            return (
              <>
                {connectors && previous && (
                  <line
                    stroke={CHART_GRID_COLOR}
                    strokeDasharray="2 2"
                    x1={center - band + width / 2}
                    x2={center - width / 2}
                    y1={y(previous.to)}
                    y2={y(previous.to)}
                  />
                )}
                <rect
                  fill={
                    striped && !step.color
                      ? `url(#${uid}-${patternIndex})`
                      : color
                  }
                  // A zero-contribution step still has to be visible.
                  height={Math.max(2, bottom - top)}
                  rx={2}
                  stroke={chartStroke(color)}
                  strokeWidth={1}
                  width={width}
                  x={center - width / 2}
                  y={top}
                />
                {labels && (
                  <text
                    className="font-primary"
                    dominantBaseline="auto"
                    fill={
                      step.kind === "total"
                        ? "var(--foreground)"
                        : CHART_TICK_COLOR
                    }
                    fontSize={11}
                    fontWeight={step.kind === "total" ? 600 : 400}
                    textAnchor="middle"
                    x={center}
                    y={top - 6}
                  >
                    {label}
                  </text>
                )}
              </>
            );
          }}
          xAxisKey="key"
        />
      </RechartsBarChart>
    </ChartContainer>
  );
}

// ─── Dumbbell ────────────────────────────────────────────────────────────────

/** Room the chart gives up at the bottom for the dumbbell's own legend. */
const DUMBBELL_LEGEND_HEIGHT = 32;

/** Whether the connector is colored neutrally or by whether the change was an improvement. */
export type ChartDumbbellTone = "neutral" | "semantic";

export interface ChartDumbbellProps extends ChartContainerProps {
  /** One entry per category, each with its two measurements. Names must be unique — they're the category axis. */
  rows: DumbbellRowInput[];
  /**
   * `"vertical"` — pairs run left to right on a row each, categories down the side. The default, and the
   * better one for long category names or more than a handful of rows.
   * `"horizontal"` — pairs run up and down in a column each, categories along the bottom. Reads well with few,
   * short categories, and matches a neighbouring `Chart.Bar` in the same layout.
   * @default "vertical"
   */
  layout?: "horizontal" | "vertical";
  /**
   * Key the rows are ordered by. A dumbbell is read by scanning the column of connectors, so sorting by
   * `"delta"` is usually what makes it say something.
   * @default "delta"
   */
  sort?: DumbbellSort;
  /**
   * Direction of that order (`"asc"` is A→Z for `"name"`).
   * @default "desc"
   */
  order?: "asc" | "desc";
  /** Label for the first measurement, in the legend and tooltip. @default "Start" */
  startLabel?: string;
  /** Label for the second measurement, in the legend and tooltip. @default "End" */
  endLabel?: string;
  /**
   * Color of the first dot.
   * @default CHART_COLORS.blue
   */
  startColor?: string;
  /**
   * Color of the second dot.
   * @default CHART_COLORS.amber
   */
  endColor?: string;
  /**
   * `"neutral"` draws every connector in the same muted ink. `"semantic"` colors it by whether the change was
   * an improvement, which only makes sense when the metric has a good direction — say so with `goodDirection`.
   * @default "neutral"
   */
  tone?: ChartDumbbellTone;
  /**
   * Which way counts as an improvement under `tone="semantic"`. For churn or latency that's `"down"`.
   * @default "up"
   */
  goodDirection?: "down" | "up";
  /**
   * Stretches the value axis down to zero. Off by default: the gap between the dots is the subject, and
   * anchoring at zero squeezes every gap into a corner of the plot.
   * @default false
   */
  includeZero?: boolean;
  /**
   * Labels each pair with its signed change, beyond the further dot.
   * @default true
   */
  labels?: boolean;
  /**
   * Renders a tooltip with both measurements and the change.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend naming the two dots.
   * @default true
   */
  legend?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the bottom axis — the value axis under `layout="vertical"`, the category one otherwise. */
  xAxisLabel?: string;
  /** Text label rendered left of the value axis. Only under `layout="horizontal"`, where that's the left one. */
  yAxisLabel?: string;
  /**
   * Width reserved for the category labels, in px. Only under `layout="vertical"`, where they run down the side.
   * @default 110
   */
  categoryWidth?: number;
  /** Formats a value for the labels, axis and tooltip. Defaults to a localized number. */
  valueFormatter?: (value: number) => string;
  /**
   * Accessible description of the chart (it's exposed as a single image).
   * @default "`Dumbbell chart comparing N categories`"
   */
  "aria-label"?: string;
}

interface ChartRowLayerProps<
  T extends {
    name: string;
  },
> {
  rows: T[];
  /** Draws one row's glyphs (SVG) given where its band sits. */
  render: (
    row: T,
    geometry: {
      /** Y of the middle of the row's band. */
      center: number;
      /** Height of the row's band. */
      band: number;
      /** Converts a value to its X pixel. */
      x: (value: number) => number;
    },
    index: number,
  ) => React.ReactNode;
}

/** The vertical-layout counterpart of `ChartGlyphLayer`: with categories on the Y axis, the bands run down the plot and the value scale is the X one. Shared by `Chart.Dumbbell` and `Chart.Gantt`, which both draw a glyph per category row. */
function ChartRowLayer<
  T extends {
    name: string;
  },
>({ rows, render }: ChartRowLayerProps<T>) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot || rows.length === 0) return null;
  // The category scale returns the *start* of a band and doesn't expose its
  // height, but bands split the plot area evenly.
  const band = plot.height / rows.length;

  return (
    <g
      style={{
        pointerEvents: "none",
      }}
    >
      {rows.map((row, index) => {
        const start = yScale(row.name);
        if (start === undefined || Number.isNaN(start)) return null;
        return (
          <g key={row.name}>
            {render(
              row,
              {
                band,
                center: start + band / 2,
                x: (value) => xScale(value) ?? 0,
              },
              index,
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Tooltip for a `Chart.Dumbbell`: both measurements and the change between them. */
function ChartDumbbellTooltip({
  active,
  payload,
  startLabel,
  endLabel,
  valueFormatter,
}: TooltipContentProps & {
  startLabel: string;
  endLabel: string;
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as DumbbellRow | undefined;
  if (!row) return null;
  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString();

  return (
    <div className={tooltipClassName}>
      <p className="mb-2 font-medium text-muted-foreground">{row.name}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
        {(
          [
            [
              startLabel,
              format(row.start),
            ],
            [
              endLabel,
              format(row.end),
            ],
            [
              "Change",
              `${row.delta > 0 ? "+" : ""}${format(row.delta)}`,
            ],
          ] as const
        ).map(([label, value]) => (
          <div
            className="col-span-2 grid grid-cols-subgrid"
            key={label}
          >
            <dt className="font-medium">{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Dumbbell chart — two measurements per category (before and after, actual and
 * plan, two cohorts) as a pair of dots joined by a connector, so the *gap* is
 * what the eye reads. Prefer it over two grouped bars when the change matters
 * more than the levels; sorted by delta, it also ranks who moved most.
 * `recharts` has no dumbbell, so the pairs are drawn by hand on its scales. One
 * of the compound `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Dumbbell
 *   endLabel="Q2"
 *   rows={[{ end: 72, name: "Support", start: 64 }]}
 *   startLabel="Q1"
 * />
 * ```
 */
function ChartDumbbell({
  rows,
  layout = "vertical",
  sort = "delta",
  order = "desc",
  startLabel = "Start",
  endLabel = "End",
  startColor = CHART_COLORS.blue,
  endColor = CHART_COLORS.amber,
  tone = "neutral",
  goodDirection = "up",
  includeZero = false,
  labels = true,
  size,
  height,
  tooltip = true,
  legend = true,
  grid = true,
  xAxisLabel,
  yAxisLabel,
  categoryWidth = 110,
  valueFormatter,
  className,
  "aria-label": ariaLabel,
}: ChartDumbbellProps) {
  const isVertical = layout === "vertical";
  const { rows: prepared, domain } = React.useMemo(
    () =>
      buildDumbbell(rows, {
        includeZero,
        order,
        sort,
      }),
    [
      rows,
      includeZero,
      order,
      sort,
    ],
  );

  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString();

  // With no pair to connect there's nothing to draw.
  if (prepared.length === 0) return null;

  const valueAxis = niceAxis(domain[0], domain[1]);
  const connectorColor = (row: DumbbellRow) => {
    if (tone === "neutral" || row.direction === "flat") return CHART_AXIS_COLOR;
    const good = row.direction === goodDirection;
    return good ? CHART_COLORS.green : CHART_COLORS.rose;
  };

  /**
   * One pair: the connector, its two dots, and the delta label beyond whichever dot sits further along the
   * value axis (so it never lands on the connector). `from`/`to` are pixels along the value axis, `center` the
   * middle of the category band on the other one — which axis that is depends on `layout`.
   */
  const pair = (row: DumbbellRow, from: number, to: number, center: number) => {
    // In the vertical layout the value axis runs rightward, in the horizontal
    // one it runs *up* the screen, so "further along" flips sign with it.
    const outward = isVertical ? to >= from : to <= from;
    return (
      <>
        <line
          stroke={connectorColor(row)}
          strokeLinecap="round"
          strokeWidth={3}
          x1={isVertical ? from : center}
          x2={isVertical ? to : center}
          y1={isVertical ? center : from}
          y2={isVertical ? center : to}
        />
        {(
          [
            [
              from,
              startColor,
            ],
            [
              to,
              endColor,
            ],
          ] as const
        ).map(([position, color]) => (
          <circle
            cx={isVertical ? position : center}
            cy={isVertical ? center : position}
            fill={color}
            key={color}
            r={5}
            stroke="var(--background)"
            strokeWidth={1.5}
          />
        ))}
        {labels && row.delta !== 0 && (
          <text
            className="font-primary"
            dominantBaseline={
              isVertical ? "middle" : outward ? "auto" : "hanging"
            }
            fill={CHART_TICK_COLOR}
            fontSize={11}
            textAnchor={isVertical ? (outward ? "start" : "end") : "middle"}
            x={isVertical ? to + (outward ? 10 : -10) : center}
            y={isVertical ? center : to + (outward ? -8 : 8)}
          >
            {row.delta > 0 ? "+" : ""}
            {format(row.delta)}
          </text>
        )}
      </>
    );
  };

  const margin = chartMargin(xAxisLabel, isVertical ? undefined : yAxisLabel);

  return (
    <div className="relative w-full">
      <ChartContainer
        aria-label={
          ariaLabel ?? `Dumbbell chart comparing ${prepared.length} categories`
        }
        className={className}
        height={height}
        role="img"
        size={size}
      >
        <RechartsBarChart
          data={prepared}
          layout={layout}
          margin={{
            ...margin,
            // recharts' own `Legend` can't be given a payload in v3, and the
            // two dots aren't series it can infer, so the legend is ours and
            // the plot gives up the room for it.
            bottom: margin.bottom + (legend ? DUMBBELL_LEGEND_HEIGHT : 0),
          }}
        >
          {grid && (
            <CartesianGrid
              // Only the value axis gets grid lines; a line per category band
              // would just box the pairs in.
              horizontal={!isVertical}
              stroke={CHART_GRID_COLOR}
              strokeDasharray="3 3"
              vertical={isVertical}
            />
          )}
          {isVertical ? (
            <>
              <XAxis
                axisLine={{
                  stroke: CHART_AXIS_COLOR,
                }}
                domain={valueAxis.domain}
                label={axisLabel(xAxisLabel, "insideBottom")}
                tick={TICK_STYLE}
                tickFormatter={format}
                tickLine={false}
                ticks={valueAxis.ticks}
                type="number"
              />
              <YAxis
                axisLine={{
                  stroke: CHART_AXIS_COLOR,
                }}
                dataKey="name"
                tick={TICK_STYLE}
                tickLine={false}
                type="category"
                width={categoryWidth}
              />
            </>
          ) : (
            <>
              <XAxis
                axisLine={{
                  stroke: CHART_AXIS_COLOR,
                }}
                dataKey="name"
                label={axisLabel(xAxisLabel, "insideBottom")}
                tick={TICK_STYLE}
                tickLine={false}
                type="category"
              />
              <YAxis
                axisLine={{
                  stroke: CHART_AXIS_COLOR,
                }}
                domain={valueAxis.domain}
                label={axisLabel(yAxisLabel, "insideLeft")}
                tick={TICK_STYLE}
                tickFormatter={format}
                tickLine={false}
                ticks={valueAxis.ticks}
                type="number"
              />
            </>
          )}
          {tooltip && (
            <Tooltip
              content={(props) => (
                <ChartDumbbellTooltip
                  {...props}
                  endLabel={endLabel}
                  startLabel={startLabel}
                  valueFormatter={valueFormatter}
                />
              )}
              cursor={{
                fill: CHART_CURSOR_COLOR,
              }}
            />
          )}
          {/* Invisible series: gives recharts a band per row to hover and a payload for the tooltip. */}
          <Bar
            dataKey="end"
            fill="transparent"
            isAnimationActive={false}
            legendType="none"
            stroke="none"
          />
          {isVertical ? (
            <ChartRowLayer
              render={(row, { center, x }) =>
                pair(row, x(row.start), x(row.end), center)
              }
              rows={prepared}
            />
          ) : (
            <ChartGlyphLayer
              data={prepared}
              render={(row, { center, y }) =>
                pair(row, y(row.start), y(row.end), center)
              }
              xAxisKey="name"
            />
          )}
        </RechartsBarChart>
      </ChartContainer>
      {legend && (
        <ul
          className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-primary text-xs text-muted-foreground"
          style={{
            minHeight: DUMBBELL_LEGEND_HEIGHT,
          }}
        >
          {(
            [
              [
                startLabel,
                startColor,
              ],
              [
                endLabel,
                endColor,
              ],
            ] as const
          ).map(([label, color]) => (
            <li
              className="flex items-center gap-2"
              key={label}
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{
                  background: color,
                }}
              />
              {label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Gantt ───────────────────────────────────────────────────────────────────

/** Room the chart gives up at the bottom for the Gantt's own group legend. */
const GANTT_LEGEND_HEIGHT = 32;

export interface ChartGanttProps extends ChartContainerProps {
  /** One entry per task, each with its dates. Names must be unique — they're the category axis and what `dependsOn` refers to. */
  tasks: GanttTaskInput[];
  /**
   * Key the tasks are ordered by, inside each group. A plan usually reads best
   * in the order it was written, so nothing is reordered by default.
   * @default "none"
   */
  sort?: GanttSort;
  /**
   * Direction of that order (`"asc"` is earliest-first for dates, A→Z for `"name"`).
   * @default "asc"
   */
  order?: "asc" | "desc";
  /**
   * Number of time-axis ticks to aim for. The step is chosen so the ticks land
   * on real hour/day/week/month boundaries near that count.
   * @default 6
   */
  ticks?: number;
  /**
   * Color of the bars when no task or group sets its own.
   * @default CHART_COLORS.blue
   */
  color?: string;
  /**
   * How the bars are filled.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Bar thickness as a share of its row's band, `0`–`1`.
   * @default 0.6
   */
  barWidth?: number;
  /**
   * Labels each bar beyond its end — the progress percentage for a task that
   * reports one, its length in days otherwise.
   * @default true
   */
  labels?: boolean;
  /** Draws a dashed vertical marker at this instant, for "where the plan stands today". Omitted (not defaulted to now) so a chart stays the same every time it renders. */
  today?: GanttDateLike;
  /**
   * Label above the `today` marker.
   * @default "Today"
   */
  todayLabel?: string;
  /**
   * Draws a connector from each predecessor's end to its dependent task's
   * start, for tasks that declare `dependsOn`.
   * @default true
   */
  dependencies?: boolean;
  /**
   * Draws a hairline between two groups, so phases read as blocks.
   * @default true
   */
  groupLines?: boolean;
  /**
   * Renders a tooltip with the task's dates, length and progress.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend naming the groups. Does nothing when no task has a `group`.
   * @default true
   */
  legend?: boolean;
  /**
   * Renders background grid lines along the time axis.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the time axis. */
  xAxisLabel?: string;
  /**
   * Width reserved for the task names running down the side, in px.
   * @default 130
   */
  categoryWidth?: number;
  /** Formats a time-axis tick. Defaults to a localized label at the axis' own granularity (a clock time, `"3 Mar"`, `"Mar"`, `"2026"`). */
  tickFormatter?: (time: number, step: GanttStep) => string;
  /** Formats a task's own dates in the tooltip. Defaults to a localized day and month. */
  dateFormatter?: (time: number) => string;
  /**
   * Accessible description of the chart (it's exposed as a single image).
   * @default "`Gantt chart of N tasks`"
   */
  "aria-label"?: string;
}

/** Tooltip for a `Chart.Gantt`: the task's group, its span, how long it runs and how far along it is. */
function ChartGanttTooltip({
  active,
  payload,
  dateFormatter,
}: TooltipContentProps & {
  dateFormatter: (time: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as GanttRow | undefined;
  if (!row) return null;
  const days = durationInDays(row.duration);

  return (
    <div className={tooltipClassName}>
      <p className="mb-2 font-medium text-muted-foreground">{row.name}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
        {(
          [
            row.group === undefined
              ? undefined
              : ([
                  "Group",
                  row.group,
                ] as const),
            row.milestone
              ? ([
                  "Date",
                  dateFormatter(row.start),
                ] as const)
              : ([
                  "Span",
                  `${dateFormatter(row.start)} – ${dateFormatter(row.end)}`,
                ] as const),
            row.milestone
              ? undefined
              : ([
                  "Duration",
                  `${days} ${days === 1 ? "day" : "days"}`,
                ] as const),
            row.progress === undefined
              ? undefined
              : ([
                  "Progress",
                  percentTick(row.progress),
                ] as const),
          ].filter(Boolean) as [
            string,
            string,
          ][]
        ).map(([label, value]) => (
          <div
            className="col-span-2 grid grid-cols-subgrid"
            key={label}
          >
            <dt className="font-medium">{label}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Gantt chart — one bar per task along a real time axis, so a plan's overlaps,
 * gaps and critical hand-offs are visible at a glance. Tasks can carry a
 * `progress` share (filled portion of the bar), a `group` (phase or workstream,
 * which colors the bars and becomes the legend), `dependsOn` links (drawn as
 * connectors) and a `milestone` flag (a diamond instead of a bar). `recharts`
 * has no Gantt, so the bars are drawn by hand on its scales, with the time axis
 * ticked on real day/month boundaries by `buildGantt`. One of the compound
 * `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Gantt
 *   tasks={[
 *     { end: "2026-03-10", name: "Design", progress: 1, start: "2026-03-01" },
 *     { dependsOn: "Design", end: "2026-03-24", name: "Build", start: "2026-03-10" },
 *   ]}
 *   today="2026-03-16"
 * />
 * ```
 */
function ChartGantt({
  tasks,
  sort = "none",
  order = "asc",
  ticks: tickCount = 6,
  color = CHART_COLORS.blue,
  pattern = "solid",
  barWidth = 0.6,
  labels = true,
  today,
  todayLabel = "Today",
  dependencies = true,
  groupLines = true,
  size,
  height,
  tooltip = true,
  legend = true,
  grid = true,
  xAxisLabel,
  categoryWidth = 130,
  tickFormatter,
  dateFormatter,
  className,
  "aria-label": ariaLabel,
}: ChartGanttProps) {
  const uid = useChartPatternId();
  const { rows, domain, ticks, step, links, groups } = React.useMemo(
    () =>
      buildGantt(tasks, {
        order,
        sort,
        ticks: tickCount,
      }),
    [
      tasks,
      order,
      sort,
      tickCount,
    ],
  );

  const formatTick = (time: number) =>
    tickFormatter ? tickFormatter(time, step) : formatGanttTick(time, step);
  const formatDate = dateFormatter ?? formatGanttDate;

  // With no dated task there's no bar to draw.
  if (rows.length === 0) return null;

  /** Color of each group, in row order — the palette rotation a legend swatch and a bar both read from. */
  const groupColors = new Map(
    groups.map((group, index) => [
      group.name,
      CHART_PALETTE[index % CHART_PALETTE.length] as string,
    ]),
  );
  const colorOf = (row: GanttRow) =>
    row.color ??
    (row.group === undefined ? color : (groupColors.get(row.group) ?? color));

  // One `<pattern>` per color actually in play, referenced by its index.
  const striped = pattern === "stripes";
  const patternColors =
    groups.length > 0
      ? [
          ...groupColors.values(),
        ]
      : [
          color,
        ];

  /** Predecessor rows of each task, by row index, so a dependent row can draw back to them. */
  const predecessors = new Map<number, number[]>();
  for (const link of links)
    predecessors.set(link.to, [
      ...(predecessors.get(link.to) ?? []),
      link.from,
    ]);

  const todayTime = today === undefined ? undefined : toTime(today);
  const hasToday =
    todayTime !== undefined &&
    Number.isFinite(todayTime) &&
    todayTime >= domain[0] &&
    todayTime <= domain[1];

  /** Row index of every group's first row but the first group's — where a separator hairline goes. */
  const separators = new Set(
    groupLines ? groups.slice(1).map((group) => group.firstRow) : [],
  );

  return (
    <div className="relative w-full">
      <ChartContainer
        aria-label={ariaLabel ?? `Gantt chart of ${rows.length} tasks`}
        className={className}
        height={height}
        role="img"
        size={size}
      >
        <RechartsBarChart
          data={rows}
          layout="vertical"
          margin={{
            ...chartMargin(xAxisLabel, undefined),
            // recharts' own `Legend` can't be given a payload in v3, and the
            // groups aren't series it can infer, so the legend is ours and the
            // plot gives up the room for it.
            bottom:
              chartMargin(xAxisLabel, undefined).bottom +
              (legend && groups.length > 0 ? GANTT_LEGEND_HEIGHT : 0),
            // Room for the label sitting beyond the last bar's end.
            right: labels ? 48 : 16,
            // Room for the `today` marker's label above the plot.
            top: hasToday ? 20 : 8,
          }}
        >
          <defs>
            {striped &&
              patternColors.map((patternColor, index) => (
                <ChartStripePattern
                  color={patternColor}
                  id={`${uid}-${index}`}
                  key={patternColor}
                />
              ))}
          </defs>
          {grid && (
            <CartesianGrid
              // Only the time axis gets grid lines; a line per task band would
              // just box the bars in.
              horizontal={false}
              stroke={CHART_GRID_COLOR}
              strokeDasharray="3 3"
              vertical
            />
          )}
          <XAxis
            axisLine={{
              stroke: CHART_AXIS_COLOR,
            }}
            domain={domain}
            label={axisLabel(xAxisLabel, "insideBottom")}
            tick={TICK_STYLE}
            tickFormatter={formatTick}
            tickLine={false}
            ticks={ticks}
            type="number"
          />
          <YAxis
            axisLine={{
              stroke: CHART_AXIS_COLOR,
            }}
            dataKey="name"
            tick={TICK_STYLE}
            tickLine={false}
            type="category"
            width={categoryWidth}
          />
          {tooltip && (
            <Tooltip
              content={(props) => (
                <ChartGanttTooltip
                  {...props}
                  dateFormatter={formatDate}
                />
              )}
              cursor={{
                fill: CHART_CURSOR_COLOR,
              }}
            />
          )}
          {/* Invisible series: gives recharts a band per task to hover and a payload for the tooltip. */}
          <Bar
            dataKey="end"
            fill="transparent"
            isAnimationActive={false}
            legendType="none"
            stroke="none"
          />
          {hasToday && (
            <ReferenceLine
              label={{
                fill: CHART_TICK_COLOR,
                fontSize: 11,
                position: "top",
                value: todayLabel,
              }}
              stroke="var(--foreground)"
              strokeDasharray="4 3"
              x={todayTime}
            />
          )}
          <ChartRowLayer
            render={(row, { center, band, x }) => {
              const rowColor = colorOf(row);
              const thickness = Math.min(28, Math.max(6, band * barWidth));
              const from = x(row.start);
              const to = x(row.end);
              const fill =
                striped && !row.color
                  ? `url(#${uid}-${Math.max(
                      0,
                      patternColors.indexOf(rowColor),
                    )})`
                  : rowColor;
              const label = row.milestone
                ? undefined
                : row.progress === undefined
                  ? `${durationInDays(row.duration)}d`
                  : percentTick(row.progress);
              const diamond = Math.min(16, thickness) / 2 + 2;

              return (
                <>
                  {separators.has(row.index) && (
                    <line
                      stroke={CHART_GRID_COLOR}
                      x1={x(domain[0])}
                      x2={x(domain[1])}
                      y1={center - band / 2}
                      y2={center - band / 2}
                    />
                  )}
                  {dependencies &&
                    (predecessors.get(row.index) ?? []).map((index) => {
                      const predecessor = rows[index];
                      if (!predecessor) return null;
                      // Bands are even, so a predecessor's center is its
                      // distance in rows away from this one.
                      const fromY = center + band * (index - row.index);
                      const fromX = x(predecessor.end);
                      const elbow = Math.max(fromX + 6, from - 10);
                      return (
                        <g key={predecessor.name}>
                          <path
                            d={`M ${fromX} ${fromY} H ${elbow} V ${center} H ${from - 5}`}
                            fill="none"
                            stroke={CHART_AXIS_COLOR}
                            strokeWidth={1}
                          />
                          <polygon
                            fill={CHART_AXIS_COLOR}
                            points={`${from - 5},${center - 3} ${from},${center} ${from - 5},${center + 3}`}
                          />
                        </g>
                      );
                    })}
                  {row.milestone ? (
                    <polygon
                      fill={fill}
                      points={`${from},${center - diamond} ${from + diamond},${center} ${from},${center + diamond} ${from - diamond},${center}`}
                      stroke={chartStroke(rowColor)}
                      strokeWidth={1}
                    />
                  ) : (
                    <>
                      <rect
                        fill={fill}
                        // The bar is the task's full span; the solid overlay
                        // below is how much of it is done.
                        fillOpacity={row.progress === undefined ? 1 : 0.35}
                        height={thickness}
                        rx={3}
                        stroke={chartStroke(rowColor)}
                        strokeWidth={1}
                        // A task shorter than the axis can resolve still has to
                        // be visible.
                        width={Math.max(2, to - from)}
                        x={from}
                        y={center - thickness / 2}
                      />
                      {row.progress !== undefined && row.progress > 0 && (
                        <rect
                          fill={fill}
                          height={thickness}
                          rx={3}
                          width={Math.max(2, (to - from) * row.progress)}
                          x={from}
                          y={center - thickness / 2}
                        />
                      )}
                    </>
                  )}
                  {labels && label !== undefined && (
                    <text
                      className="font-primary"
                      dominantBaseline="middle"
                      fill={CHART_TICK_COLOR}
                      fontSize={11}
                      textAnchor="start"
                      x={to + 8}
                      y={center}
                    >
                      {label}
                    </text>
                  )}
                </>
              );
            }}
            rows={rows}
          />
        </RechartsBarChart>
      </ChartContainer>
      {legend && groups.length > 0 && (
        <ul
          className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-primary text-xs text-muted-foreground"
          style={{
            minHeight: GANTT_LEGEND_HEIGHT,
          }}
        >
          {groups.map((group) => (
            <li
              className="flex items-center gap-2"
              key={group.name}
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-sm"
                style={{
                  background: groupColors.get(group.name),
                }}
              />
              {group.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Box plot ────────────────────────────────────────────────────────────────

export interface ChartBoxPlotDatum {
  /** Category label on the X axis, e.g. a group or region. */
  name: string;
  /** Smallest non-outlier value (the lower whisker's end). */
  min: number;
  /** First quartile (bottom of the box). */
  q1: number;
  /** Median (the line inside the box). */
  median: number;
  /** Third quartile (top of the box). */
  q3: number;
  /** Largest non-outlier value (the upper whisker's end). */
  max: number;
  /** Values beyond the whiskers, drawn as individual circles. */
  outliers?: number[];
  /** Fill color of this box; falls back to `CHART_PALETTE[index]` when the chart has no `color`. */
  color?: string;
}

export interface ChartBoxPlotProps extends ChartContainerProps {
  /** One entry per box, with its five-number summary (and optional outliers). */
  data: ChartBoxPlotDatum[];
  /** Fill color for every box, replacing the per-box palette rotation (a datum's own `color` still wins). */
  color?: string;
  /**
   * Fill style of the boxes.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Box width as a fraction of its category band (0–1).
   * @default 0.5
   */
  boxWidth?: number;
  /**
   * Renders a tooltip with the five-number summary on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the X axis. */
  xAxisLabel?: string;
  /** Text label rendered left of the Y axis. */
  yAxisLabel?: string;
  /** Formats a value for the tooltip. */
  valueFormatter?: (value: number) => string;
  /**
   * Accessible description of the chart (it's exposed as a single image).
   * @default "Box plot of N groups"
   */
  "aria-label"?: string;
}

/**
 * Box plot (box-and-whisker) — the spread of a distribution per group: the
 * box spans the first to third quartile, a line marks the median, whiskers
 * reach the min and max, and outliers are single circles. `recharts` has no
 * box plot, so the glyphs are drawn by hand on a `BarChart`'s own scales. One
 * of the compound `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.BoxPlot
 *   data={[{ max: 90, median: 62, min: 30, name: "EU", q1: 48, q3: 75 }]}
 * />
 * ```
 */
function ChartBoxPlot({
  data,
  color,
  pattern = "solid",
  boxWidth = 0.5,
  size,
  height,
  tooltip = true,
  grid = true,
  xAxisLabel,
  yAxisLabel,
  valueFormatter,
  className,
  "aria-label": ariaLabel,
}: ChartBoxPlotProps) {
  const uid = useChartPatternId();
  const colorAt = (datum: ChartBoxPlotDatum, index: number) =>
    datum.color ?? color ?? CHART_PALETTE[index % CHART_PALETTE.length];
  const { domain, ticks } = niceAxis(
    Math.min(...data.map((d) => Math.min(d.min, ...(d.outliers ?? [])))),
    Math.max(...data.map((d) => Math.max(d.max, ...(d.outliers ?? [])))),
  );

  return (
    <ChartContainer
      aria-label={ariaLabel ?? `Box plot of ${data.length} groups`}
      className={className}
      height={height}
      role="img"
      size={size}
    >
      <RechartsBarChart
        data={data}
        margin={chartMargin(xAxisLabel, yAxisLabel)}
      >
        <defs>
          {pattern === "stripes" &&
            data.map((datum, index) => (
              <ChartStripePattern
                color={colorAt(datum, index)}
                id={`${uid}-${index}`}
                key={datum.name}
              />
            ))}
        </defs>
        {grid && (
          <CartesianGrid
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
            vertical={false}
          />
        )}
        <XAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          dataKey="name"
          label={axisLabel(xAxisLabel, "insideBottom")}
          tick={TICK_STYLE}
          tickLine={false}
        />
        <YAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          domain={domain}
          label={axisLabel(yAxisLabel, "insideLeft")}
          tick={TICK_STYLE}
          tickLine={false}
          ticks={ticks}
        />
        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartBoxPlotTooltip
                {...props}
                valueFormatter={valueFormatter}
              />
            )}
            cursor={{
              fill: CHART_CURSOR_COLOR,
            }}
          />
        )}
        {/* Invisible series: gives recharts a band per category to hover and a payload for the tooltip. */}
        <Bar
          dataKey="max"
          fill="transparent"
          isAnimationActive={false}
          legendType="none"
          stroke="none"
        />
        <ChartGlyphLayer
          data={data}
          render={(datum, { center, band, y }, index) => {
            const fill = colorAt(datum, index);
            const stroke = chartStroke(fill, 55);
            const width = Math.max(6, band * boxWidth);
            const left = center - width / 2;
            const top = y(datum.q3);
            const bottom = y(datum.q1);
            const cap = width * 0.4;
            return (
              <>
                <line
                  stroke={stroke}
                  strokeWidth={1.5}
                  x1={center}
                  x2={center}
                  y1={y(datum.max)}
                  y2={top}
                />
                <line
                  stroke={stroke}
                  strokeWidth={1.5}
                  x1={center}
                  x2={center}
                  y1={bottom}
                  y2={y(datum.min)}
                />
                {[
                  datum.max,
                  datum.min,
                ].map((value) => (
                  <line
                    key={value}
                    stroke={stroke}
                    strokeLinecap="round"
                    strokeWidth={1.5}
                    x1={center - cap / 2}
                    x2={center + cap / 2}
                    y1={y(value)}
                    y2={y(value)}
                  />
                ))}
                <rect
                  fill={pattern === "stripes" ? `url(#${uid}-${index})` : fill}
                  height={Math.max(1, bottom - top)}
                  rx={3}
                  stroke={chartStroke(fill)}
                  strokeWidth={1}
                  width={width}
                  x={left}
                  y={top}
                />
                <line
                  stroke="var(--foreground)"
                  strokeLinecap="round"
                  strokeWidth={2}
                  x1={left}
                  x2={left + width}
                  y1={y(datum.median)}
                  y2={y(datum.median)}
                />
                {(datum.outliers ?? []).map((value) => (
                  <circle
                    cx={center}
                    cy={y(value)}
                    fill="var(--background)"
                    key={value}
                    r={3.5}
                    stroke={stroke}
                    strokeWidth={1.5}
                  />
                ))}
              </>
            );
          }}
          xAxisKey="name"
        />
      </RechartsBarChart>
    </ChartContainer>
  );
}

function ChartBoxPlotTooltip({
  active,
  payload,
  valueFormatter,
}: TooltipContentProps & {
  valueFormatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload as ChartBoxPlotDatum | undefined;
  if (!datum) return null;
  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : String(value);
  const rows: [
    string,
    number,
  ][] = [
    [
      "Max",
      datum.max,
    ],
    [
      "Q3",
      datum.q3,
    ],
    [
      "Median",
      datum.median,
    ],
    [
      "Q1",
      datum.q1,
    ],
    [
      "Min",
      datum.min,
    ],
  ];

  return (
    <div className={tooltipClassName}>
      <p className="mb-2 font-medium text-muted-foreground">{datum.name}</p>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div
            className="col-span-2 grid grid-cols-subgrid"
            key={label}
          >
            <dt className="font-medium">{label}</dt>
            <dd className="text-right tabular-nums">{format(value)}</dd>
          </div>
        ))}
        {datum.outliers && datum.outliers.length > 0 && (
          <div className="col-span-2 grid grid-cols-subgrid">
            <dt className="font-medium">Outliers</dt>
            <dd className="text-right tabular-nums">
              {datum.outliers.map(format).join(", ")}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

// ─── Candlestick ─────────────────────────────────────────────────────────────

export interface ChartCandlestickDatum {
  /** Category label on the X axis, usually the period (a date or time). */
  label: string;
  /** Price at the start of the period. */
  open: number;
  /** Highest price of the period. */
  high: number;
  /** Lowest price of the period. */
  low: number;
  /** Price at the end of the period. */
  close: number;
}

export interface ChartCandlestickProps extends ChartContainerProps {
  /** One entry per period, with its open / high / low / close. */
  data: ChartCandlestickDatum[];
  /**
   * Color of candles that closed at or above their open.
   * @default CHART_COLORS.green
   */
  upColor?: string;
  /**
   * Color of candles that closed below their open.
   * @default CHART_COLORS.rose
   */
  downColor?: string;
  /**
   * Fill style of the candle bodies. Stripes are drawn on the down candles so direction never depends on color alone.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Candle body width as a fraction of its category band (0–1).
   * @default 0.6
   */
  bodyWidth?: number;
  /**
   * Renders a tooltip with open / high / low / close on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the X axis. */
  xAxisLabel?: string;
  /** Text label rendered left of the Y axis. */
  yAxisLabel?: string;
  /** Formats a price for the tooltip. */
  valueFormatter?: (value: number) => string;
  /**
   * Accessible description of the chart (it's exposed as a single image).
   * @default "Candlestick chart of N periods"
   */
  "aria-label"?: string;
}

/**
 * Candlestick chart — price movement per period: the body spans open to
 * close (one color when the price rose, another when it fell) and the thin
 * wick reaches the high and low. `recharts` has no candlestick, so the
 * candles are drawn by hand on a `BarChart`'s own scales. One of the compound
 * `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Candlestick
 *   data={[{ close: 112, high: 118, label: "Mon", low: 98, open: 100 }]}
 * />
 * ```
 */
function ChartCandlestick({
  data,
  upColor = CHART_COLORS.green,
  downColor = CHART_COLORS.rose,
  pattern = "solid",
  bodyWidth = 0.6,
  size,
  height,
  tooltip = true,
  grid = true,
  xAxisLabel,
  yAxisLabel,
  valueFormatter,
  className,
  "aria-label": ariaLabel,
}: ChartCandlestickProps) {
  const uid = useChartPatternId();
  const { domain, ticks } = niceAxis(
    Math.min(...data.map((d) => d.low)),
    Math.max(...data.map((d) => d.high)),
  );

  return (
    <ChartContainer
      aria-label={ariaLabel ?? `Candlestick chart of ${data.length} periods`}
      className={className}
      height={height}
      role="img"
      size={size}
    >
      <RechartsBarChart
        data={data}
        margin={chartMargin(xAxisLabel, yAxisLabel)}
      >
        <defs>
          {pattern === "stripes" && (
            <ChartStripePattern
              color={downColor}
              id={`${uid}-down`}
            />
          )}
        </defs>
        {grid && (
          <CartesianGrid
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
            vertical={false}
          />
        )}
        <XAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          dataKey="label"
          label={axisLabel(xAxisLabel, "insideBottom")}
          tick={TICK_STYLE}
          tickLine={false}
        />
        <YAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          domain={domain}
          label={axisLabel(yAxisLabel, "insideLeft")}
          tick={TICK_STYLE}
          tickLine={false}
          ticks={ticks}
        />
        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartCandlestickTooltip
                {...props}
                downColor={downColor}
                upColor={upColor}
                valueFormatter={valueFormatter}
              />
            )}
            cursor={{
              fill: CHART_CURSOR_COLOR,
            }}
          />
        )}
        {/* Invisible series: gives recharts a band per period to hover and a payload for the tooltip. */}
        <Bar
          dataKey="high"
          fill="transparent"
          isAnimationActive={false}
          legendType="none"
          stroke="none"
        />
        <ChartGlyphLayer
          data={data}
          render={(datum, { center, band, y }) => {
            const up = datum.close >= datum.open;
            const fill = up ? upColor : downColor;
            const stroke = chartStroke(fill, 45);
            const width = Math.max(4, band * bodyWidth);
            const top = y(Math.max(datum.open, datum.close));
            const bottom = y(Math.min(datum.open, datum.close));
            return (
              <>
                <line
                  stroke={stroke}
                  strokeLinecap="round"
                  strokeWidth={1.5}
                  x1={center}
                  x2={center}
                  y1={y(datum.high)}
                  y2={y(datum.low)}
                />
                <rect
                  fill={
                    !up && pattern === "stripes" ? `url(#${uid}-down)` : fill
                  }
                  // A doji (open == close) still gets a visible sliver.
                  height={Math.max(2, bottom - top)}
                  rx={2}
                  stroke={stroke}
                  strokeWidth={1}
                  width={width}
                  x={center - width / 2}
                  y={top}
                />
              </>
            );
          }}
          xAxisKey="label"
        />
      </RechartsBarChart>
    </ChartContainer>
  );
}

function ChartCandlestickTooltip({
  active,
  payload,
  valueFormatter,
  upColor,
  downColor,
}: TooltipContentProps & {
  valueFormatter?: (value: number) => string;
  upColor: string;
  downColor: string;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload as ChartCandlestickDatum | undefined;
  if (!datum) return null;
  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : String(value);
  const change = datum.close - datum.open;
  const percent = datum.open === 0 ? 0 : (change / datum.open) * 100;
  const rows: [
    string,
    number,
  ][] = [
    [
      "Open",
      datum.open,
    ],
    [
      "High",
      datum.high,
    ],
    [
      "Low",
      datum.low,
    ],
    [
      "Close",
      datum.close,
    ],
  ];

  return (
    <div className={tooltipClassName}>
      <p className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{
            background: change >= 0 ? upColor : downColor,
          }}
        />
        {datum.label}
      </p>
      <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div
            className="col-span-2 grid grid-cols-subgrid"
            key={label}
          >
            <dt className="font-medium">{label}</dt>
            <dd className="text-right tabular-nums">{format(value)}</dd>
          </div>
        ))}
        <div className="col-span-2 grid grid-cols-subgrid border-t border-border pt-1">
          <dt className="font-medium">Change</dt>
          <dd className="text-right tabular-nums">
            {change >= 0 ? "+" : "−"}
            {Math.abs(percent).toFixed(2)}%
          </dd>
        </div>
      </dl>
    </div>
  );
}

// ─── Population pyramid ──────────────────────────────────────────────────────

export interface ChartPyramidDatum {
  /** Category on the vertical axis, e.g. an age group. Items are listed top to bottom in the order given. */
  label: string;
  /** Value of the left side (a positive number; it is drawn leftwards). */
  left: number;
  /** Value of the right side (a positive number). */
  right: number;
}

export interface ChartPyramidProps extends ChartContainerProps {
  /** One entry per row of the pyramid, top to bottom. */
  data: ChartPyramidDatum[];
  /**
   * Name of the left side, shown in the legend and tooltip.
   * @default "Left"
   */
  leftLabel?: string;
  /**
   * Name of the right side, shown in the legend and tooltip.
   * @default "Right"
   */
  rightLabel?: string;
  /**
   * Color of the left bars.
   * @default CHART_COLORS.blue
   */
  leftColor?: string;
  /**
   * Color of the right bars.
   * @default CHART_COLORS.rose
   */
  rightColor?: string;
  /**
   * Fill style of the bars.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders a legend below the chart.
   * @default true
   */
  legend?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the value axis. */
  xAxisLabel?: string;
  /** Formats a value for the axis ticks and the tooltip. */
  valueFormatter?: (value: number) => string;
}

/**
 * Population pyramid — two mirrored horizontal bar series sharing a category
 * axis (typically age groups), one growing left from a center line and the
 * other right, to compare two populations at a glance. One of the compound
 * `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Pyramid
 *   data={[{ label: "0–14", left: 4.1, right: 3.9 }]}
 *   leftLabel="Male"
 *   rightLabel="Female"
 * />
 * ```
 */
function ChartPyramid({
  data,
  leftLabel = "Left",
  rightLabel = "Right",
  leftColor = CHART_COLORS.blue,
  rightColor = CHART_COLORS.rose,
  pattern = "solid",
  size,
  height,
  tooltip = true,
  legend = true,
  grid = true,
  xAxisLabel,
  valueFormatter,
  className,
}: ChartPyramidProps) {
  const uid = useChartPatternId();
  const striped = pattern === "stripes";
  const format = (value: number) =>
    valueFormatter ? valueFormatter(Math.abs(value)) : String(Math.abs(value));
  // Left values are negated so the two stacks diverge from zero.
  const rows = data.map((datum) => ({
    __left: -Math.abs(datum.left),
    __right: Math.abs(datum.right),
    label: datum.label,
  }));

  return (
    <ChartContainer
      className={className}
      height={height}
      size={size}
    >
      <RechartsBarChart
        data={rows}
        layout="vertical"
        margin={chartMargin(xAxisLabel, undefined)}
        stackOffset="sign"
      >
        <defs>
          {striped && (
            <>
              <ChartStripePattern
                color={leftColor}
                id={`${uid}-left`}
              />
              <ChartStripePattern
                color={rightColor}
                id={`${uid}-right`}
              />
            </>
          )}
        </defs>
        {grid && (
          <CartesianGrid
            horizontal={false}
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
          />
        )}
        <XAxis
          axisLine={{
            stroke: CHART_AXIS_COLOR,
          }}
          label={axisLabel(xAxisLabel, "insideBottom")}
          tick={TICK_STYLE}
          tickFormatter={(value: number) => format(value)}
          tickLine={false}
          type="number"
        />
        <YAxis
          axisLine={false}
          dataKey="label"
          tick={TICK_STYLE}
          tickLine={false}
          type="category"
          width={56}
        />
        <ReferenceLine
          stroke="var(--foreground-tertiary)"
          x={0}
        />
        {tooltip && (
          <Tooltip
            content={(props) => (
              <ChartPyramidTooltip
                {...props}
                format={format}
                leftColor={leftColor}
                leftLabel={leftLabel}
                rightColor={rightColor}
                rightLabel={rightLabel}
              />
            )}
            cursor={{
              fill: CHART_CURSOR_COLOR,
            }}
          />
        )}
        {legend && (
          <Legend
            formatter={legendFormatter}
            wrapperStyle={{
              color: CHART_TICK_COLOR,
              fontSize: 12,
              paddingTop: 16,
            }}
          />
        )}
        {(
          [
            [
              "__left",
              leftLabel,
              leftColor,
              "left",
              [
                4,
                0,
                0,
                4,
              ],
            ],
            [
              "__right",
              rightLabel,
              rightColor,
              "right",
              [
                0,
                4,
                4,
                0,
              ],
            ],
          ] as const
        ).map(([dataKey, name, color, side, radius]) => (
          <Bar
            dataKey={dataKey}
            fill={color}
            key={dataKey}
            name={name}
            radius={
              radius as unknown as [
                number,
                number,
                number,
                number,
              ]
            }
            shape={
              striped
                ? (props: BarShapeProps) => (
                    <Rectangle
                      {...props}
                      fill={`url(#${uid}-${side})`}
                    />
                  )
                : undefined
            }
            stackId="pyramid"
            stroke={chartStroke(color)}
            strokeWidth={1}
          />
        ))}
      </RechartsBarChart>
    </ChartContainer>
  );
}

function ChartPyramidTooltip({
  active,
  payload,
  label,
  format,
  leftLabel,
  rightLabel,
  leftColor,
  rightColor,
}: TooltipContentProps & {
  format: (value: number) => string;
  leftLabel: string;
  rightLabel: string;
  leftColor: string;
  rightColor: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as
    | {
        __left: number;
        __right: number;
      }
    | undefined;
  if (!row) return null;

  return (
    <div className={tooltipClassName}>
      <p className="mb-2 font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-1">
        {[
          [
            leftLabel,
            leftColor,
            row.__left,
          ],
          [
            rightLabel,
            rightColor,
            row.__right,
          ],
        ].map(([name, color, value]) => (
          <div
            className="flex items-center gap-2"
            key={String(name)}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                background: String(color),
              }}
            />
            <span className="font-medium">{String(name)}:</span>
            <span>{format(Number(value))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Shared: hover tooltip for HTML-drawn charts ─────────────────────────────

/** Small hover tooltip for charts drawn with plain HTML (no recharts `Tooltip`): `show` anchors it above the hovered/focused element, `node` is the element to render inside a `relative` container that also gets `ref`. */
function useCellTooltip() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [tip, setTip] = React.useState<{
    left: number;
    top: number;
    content: React.ReactNode;
  } | null>(null);

  const show = (
    // `Element`, not `HTMLElement`: the histogram's hover targets are SVG rects.
    event: React.SyntheticEvent<Element>,
    content: React.ReactNode,
  ) => {
    const container = ref.current?.getBoundingClientRect();
    const cell = event.currentTarget.getBoundingClientRect();
    if (!container) return;
    setTip({
      content,
      left: cell.left - container.left + cell.width / 2,
      top: cell.top - container.top,
    });
  };
  const hide = () => setTip(null);

  const node = tip && (
    <div
      className={cn(
        tooltipClassName,
        "pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap",
      )}
      role="tooltip"
      style={{
        left: tip.left,
        top: tip.top - 8,
      }}
    >
      {tip.content}
    </div>
  );

  return {
    hide,
    node,
    ref,
    show,
  };
}

// ─── Histogram ───────────────────────────────────────────────────────────────

/** Ticks from zero up to a readable bound above `hi`. Counts and shares have to start at zero, so `niceAxis` — which pads both ends — would put the baseline below the axis. */
function zeroBasedAxis(hi: number): {
  domain: [
    number,
    number,
  ];
  ticks: number[];
} {
  if (!(hi > 0))
    return {
      domain: [
        0,
        1,
      ],
      ticks: [
        0,
        1,
      ],
    };
  const target = hi / 4;
  const power = 10 ** Math.floor(Math.log10(target));
  const fraction = target / power;
  const step =
    (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  const end = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  // Rounded to dodge float noise such as 0.30000000000000004.
  for (let value = 0; value <= end + step / 2; value += step)
    ticks.push(Number(value.toFixed(10)));
  return {
    domain: [
      0,
      end,
    ],
    ticks,
  };
}

/** Bins are contiguous by definition, so they're separated by a hairline rather than the gap a bar chart puts between categories. */
const HISTOGRAM_BIN_GAP = 1;

/** Most ticks an automatic value axis will label before edges start being skipped. */
const HISTOGRAM_MAX_TICKS = 11;

/** What the bars' height measures. */
export type ChartHistogramMeasure = "count" | "share";

/** Statistic marked with a vertical reference line across the plot. */
export type ChartHistogramMarker = "none" | "mean" | "median";

export interface ChartHistogramProps extends ChartContainerProps {
  /** Raw observations — one number per item, not pre-aggregated bins. Non-finite values are ignored. */
  data: number[];
  /**
   * A target number of bins, or explicit edges (`[0, 10, 20, 50]` — 3 bins, the last one wider, which the
   * continuous axis draws at its true width). Omit for a count derived from `rule`.
   */
  bins?: number | number[];
  /**
   * Rule that derives the bin count from the data's spread when `bins` is omitted: Freedman–Diaconis scales
   * with the interquartile range (so outliers don't shred the bulk), Scott's with the standard deviation, and
   * Sturges' with the sample size alone.
   * @default "freedman-diaconis"
   */
  rule?: HistogramRule;
  /**
   * Rounds automatic bin edges to readable steps, so the axis reads `0, 10, 20…` instead of `3, 12.4, 21.8…`.
   * The bin count then lands near `bins` rather than exactly on it. Ignored when `bins` is an array.
   * @default true
   */
  nice?: boolean;
  /**
   * Whether the bars measure how many observations fell in each bin, or each bin's share of the sample (the
   * value axis then reads in percent).
   * @default "count"
   */
  measure?: ChartHistogramMeasure;
  /**
   * Bar color — a `CHART_COLORS` entry, a `var(--token)` or any CSS color. A histogram shows one variable, so
   * there's no series rotation to apply.
   * @default CHART_COLORS.blue
   */
  color?: string;
  /**
   * Fill style of the bars.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Marks the sample's mean or median with a dashed vertical line, for reading skew against the bulk.
   * @default "none"
   */
  marker?: ChartHistogramMarker;
  /**
   * Renders a tooltip with each bin's range, count and share on hover — anywhere in the bin's column, not
   * just on the bar.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Renders background grid lines.
   * @default true
   */
  grid?: boolean;
  /** Text label rendered below the X axis — the unit being measured, e.g. `"Response time (ms)"`. */
  xAxisLabel?: string;
  /** Text label rendered left of the Y axis. */
  yAxisLabel?: string;
  /** Formats an observation for the bin-edge ticks and the tooltip's range. Defaults to a localized number. */
  valueFormatter?: (value: number) => string;
  /**
   * Accessible description of the chart (it's exposed as a single image).
   * @default "`Histogram of N values in M bins`"
   */
  "aria-label"?: string;
}

interface ChartHistogramLayerProps {
  bins: HistogramBin[];
  measure: ChartHistogramMeasure;
  fill: string;
  stroke: string;
  /** Called when the pointer enters a bin's column; omitted when the chart has no tooltip. */
  onEnter?: (
    event: React.MouseEvent<SVGRectElement>,
    bin: HistogramBin,
  ) => void;
  onLeave?: () => void;
}

/** Draws the bars on the chart's own scales, so each one spans its bin's true width — which is what makes unequal bins readable and keeps them aligned with the edge ticks. Each bar also gets a full-height transparent twin, so hovering anywhere in the column works, not only on a short bar. */
function ChartHistogramLayer({
  bins,
  measure,
  fill,
  stroke,
  onEnter,
  onLeave,
}: ChartHistogramLayerProps) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot) return null;
  const toX = (value: number) => xScale(value) ?? 0;
  const toY = (value: number) => yScale(value) ?? 0;
  const baseline = toY(0);

  return (
    <g>
      {bins.map((bin) => {
        const left = toX(bin.from);
        const right = toX(bin.to);
        const span = Math.max(1, right - left);
        const value = measure === "share" ? bin.share : bin.count;
        const top = toY(value);
        return (
          <g key={`${bin.from}-${bin.to}`}>
            {bin.count > 0 && (
              <rect
                fill={fill}
                height={Math.max(1, baseline - top)}
                pointerEvents="none"
                rx={2}
                stroke={stroke}
                strokeWidth={1}
                width={Math.max(1, span - HISTOGRAM_BIN_GAP)}
                x={left + HISTOGRAM_BIN_GAP / 2}
                y={top}
              />
            )}
            {onEnter && (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover-only affordance inside a chart already exposed as a single labelled image.
              <rect
                fill="transparent"
                height={plot.height}
                onMouseEnter={(event) => onEnter(event, bin)}
                onMouseLeave={onLeave}
                width={span}
                x={left}
                y={plot.y}
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Histogram — how a single continuous variable is distributed. Takes the raw
 * observations and does the binning itself (`binValues`), then draws the bars
 * on a continuous axis, so unequal bins keep their true width instead of being
 * flattened into equal categories the way a bar chart would. `recharts` has no
 * histogram, so the bars are drawn by hand on its scales. One of the compound
 * `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Histogram data={responseTimes} marker="median" xAxisLabel="Response time (ms)" />
 * <Chart.Histogram bins={[0, 100, 250, 500, 1000]} data={responseTimes} />
 * ```
 */
function ChartHistogram({
  data,
  bins,
  rule = "freedman-diaconis",
  nice = true,
  measure = "count",
  color = CHART_COLORS.blue,
  pattern = "solid",
  marker = "none",
  size,
  height,
  tooltip = true,
  grid = true,
  xAxisLabel,
  yAxisLabel,
  valueFormatter,
  className,
  "aria-label": ariaLabel,
}: ChartHistogramProps) {
  const uid = useChartPatternId();
  const tip = useCellTooltip();
  const binned = React.useMemo(
    () =>
      binValues(data, {
        bins,
        nice,
        rule,
      }),
    [
      data,
      bins,
      nice,
      rule,
    ],
  );

  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString();

  // An empty sample has no range to draw an axis over, so there's no chart.
  if (binned.length === 0) return null;

  const first = binned[0] as HistogramBin;
  const last = binned[binned.length - 1] as HistogramBin;
  const edges = [
    ...binned.map((bin) => bin.from),
    last.to,
  ];
  // Every edge is a meaningful tick, but past a dozen they collide, so label
  // every nth one — always keeping the last, which closes the range.
  const stride = Math.ceil(edges.length / HISTOGRAM_MAX_TICKS);
  const xTicks = edges.filter(
    (_, index) => index % stride === 0 || index === edges.length - 1,
  );

  const values = binned.map((bin) =>
    measure === "share" ? bin.share : bin.count,
  );
  const valueAxis = zeroBasedAxis(Math.max(...values));
  const striped = pattern === "stripes";
  const stroke = chartStroke(color);

  const sorted = data
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const markerValue =
    marker === "mean"
      ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length
      : marker === "median"
        ? quantile(sorted, 0.5)
        : undefined;

  return (
    <div
      className="relative w-full"
      ref={tip.ref}
    >
      <ChartContainer
        aria-label={
          ariaLabel ??
          `Histogram of ${sorted.length} values in ${binned.length} bins`
        }
        className={className}
        height={height}
        role="img"
        size={size}
      >
        <RechartsScatterChart margin={chartMargin(xAxisLabel, yAxisLabel)}>
          <defs>
            {striped && (
              <ChartStripePattern
                color={color}
                id={uid}
              />
            )}
          </defs>
          {grid && (
            <CartesianGrid
              stroke={CHART_GRID_COLOR}
              strokeDasharray="3 3"
              vertical={false}
            />
          )}
          <XAxis
            axisLine={{
              stroke: CHART_AXIS_COLOR,
            }}
            dataKey="value"
            domain={[
              first.from,
              last.to,
            ]}
            label={axisLabel(xAxisLabel, "insideBottom")}
            tick={TICK_STYLE}
            tickFormatter={format}
            tickLine={false}
            ticks={xTicks}
            type="number"
          />
          <YAxis
            axisLine={{
              stroke: CHART_AXIS_COLOR,
            }}
            dataKey="measure"
            domain={valueAxis.domain}
            label={axisLabel(yAxisLabel, "insideLeft")}
            tick={TICK_STYLE}
            tickFormatter={measure === "share" ? percentTick : undefined}
            tickLine={false}
            ticks={valueAxis.ticks}
            type="number"
          />
          {/* Gives recharts a series to build its scales from; the bars themselves are drawn by the layer. */}
          <Scatter
            data={binned.map((bin) => ({
              measure: measure === "share" ? bin.share : bin.count,
              value: (bin.from + bin.to) / 2,
            }))}
            fill="transparent"
            isAnimationActive={false}
            legendType="none"
            shape={() => <g />}
          />
          {markerValue !== undefined && Number.isFinite(markerValue) && (
            <ReferenceLine
              label={{
                fill: CHART_TICK_COLOR,
                fontSize: 12,
                position: "top",
                value: marker === "mean" ? "Mean" : "Median",
              }}
              stroke="var(--foreground)"
              strokeDasharray="4 3"
              x={markerValue}
            />
          )}
          <ChartHistogramLayer
            bins={binned}
            fill={striped ? `url(#${uid})` : color}
            measure={measure}
            onEnter={
              tooltip
                ? (event, bin) =>
                    tip.show(
                      event,
                      <>
                        <p className="mb-1 font-medium text-muted-foreground">
                          {format(bin.from)} – {format(bin.to)}
                        </p>
                        <p className="flex items-center gap-2">
                          <span className="font-medium tabular-nums">
                            {bin.count.toLocaleString()}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {percentTick(bin.share)}
                          </span>
                        </p>
                      </>,
                    )
                : undefined
            }
            onLeave={tip.hide}
            stroke={stroke}
          />
        </RechartsScatterChart>
      </ChartContainer>
      {tip.node}
    </div>
  );
}

// ─── Heatmap ─────────────────────────────────────────────────────────────────

export interface ChartHeatmapCell {
  /** Column of the cell (matches an entry of `xLabels`, or the order of first appearance). */
  x: string;
  /** Row of the cell. */
  y: string;
  /** Value that sets the cell's intensity. */
  value: number;
}

export interface ChartHeatmapProps extends ChartContainerProps {
  /** One entry per filled cell. Pairs with no entry are drawn empty. */
  data: ChartHeatmapCell[];
  /** Order of the columns, left to right. Defaults to the order in which `x` values first appear in `data`. */
  xLabels?: string[];
  /** Order of the rows, top to bottom. Defaults to the order in which `y` values first appear in `data`. */
  yLabels?: string[];
  /**
   * Color of the highest value; lower values fade toward the canvas.
   * @default CHART_COLORS.blue
   */
  color?: string;
  /** Value mapped to the faintest cell. Defaults to the smallest value in `data`. */
  min?: number;
  /** Value mapped to the strongest cell. Defaults to the largest value in `data`. */
  max?: number;
  /**
   * Writes each cell's value inside it.
   * @default false
   */
  showValues?: boolean;
  /**
   * Renders the color scale (min → max) under the grid.
   * @default true
   */
  legend?: boolean;
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /** Formats a value for the cells, the scale and the tooltip. */
  valueFormatter?: (value: number) => string;
  /**
   * Screen-reader-only text for a cell with no entry.
   * @default "No data"
   */
  noDataLabel?: string;
}

/**
 * Heatmap — a grid of cells whose color intensity encodes a value (activity
 * by weekday and hour, correlation matrices). Built as a real `<table>`, so
 * screen readers get row/column headers and every cell's value. Intensity
 * fades from the canvas to `color`, which keeps it pastel in both themes. One
 * of the compound `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Heatmap
 *   data={[{ value: 12, x: "Mon", y: "9am" }, { value: 40, x: "Tue", y: "9am" }]}
 * />
 * ```
 */
function ChartHeatmap({
  data,
  noDataLabel = "No data",
  xLabels,
  yLabels,
  color = CHART_COLORS.blue,
  min,
  max,
  showValues = false,
  legend = true,
  tooltip = true,
  valueFormatter,
  size = "md",
  height,
  className,
}: ChartHeatmapProps) {
  const { ref, show, hide, node } = useCellTooltip();
  const xs = xLabels ?? [
    ...new Set(data.map((cell) => cell.x)),
  ];
  const ys = yLabels ?? [
    ...new Set(data.map((cell) => cell.y)),
  ];
  const values = new Map(
    data.map((cell) => [
      `${cell.x}\u0000${cell.y}`,
      cell.value,
    ]),
  );
  const all = data.map((cell) => cell.value);
  const lo = min ?? Math.min(...all);
  const hi = max ?? Math.max(...all);
  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString();
  const strength = (value: number) =>
    hi === lo ? 1 : Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  const mix = (t: number) =>
    `color-mix(in oklab, ${color} ${Math.round(8 + 92 * t)}%, var(--background))`;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only clears the hover tooltip when the pointer leaves the chart.
    <div
      className={cn("relative flex w-full flex-col gap-3", className)}
      onMouseLeave={hide}
      ref={ref}
    >
      <div
        style={{
          height: height ?? sizeToHeight[size],
        }}
      >
        <table className="h-full w-full table-fixed border-separate border-spacing-0.5 font-primary text-xs">
          <thead>
            <tr>
              <td className="w-16" />
              {xs.map((x) => (
                <th
                  className="pb-1 font-normal text-muted-foreground"
                  key={x}
                  scope="col"
                >
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ys.map((y) => (
              <tr key={y}>
                <th
                  className="truncate pr-2 text-right font-normal text-muted-foreground"
                  scope="row"
                >
                  {y}
                </th>
                {xs.map((x) => {
                  const value = values.get(`${x}\u0000${y}`);
                  if (value === undefined)
                    return (
                      <td
                        className="rounded-md bg-muted"
                        key={x}
                      >
                        <span className="sr-only">{noDataLabel}</span>
                      </td>
                    );
                  const t = strength(value);
                  return (
                    <td
                      className="rounded-md text-center"
                      key={x}
                      onMouseEnter={
                        tooltip
                          ? (event) =>
                              show(
                                event,
                                <div className="flex items-center gap-2">
                                  <span
                                    aria-hidden="true"
                                    className="size-2 shrink-0 rounded-full"
                                    style={{
                                      background: mix(t),
                                    }}
                                  />
                                  <span className="font-medium">
                                    {y} · {x}:
                                  </span>
                                  <span>{format(value)}</span>
                                </div>,
                              )
                          : undefined
                      }
                      style={{
                        background: mix(t),
                        color: t > 0.55 ? "var(--black)" : "var(--foreground)",
                      }}
                    >
                      {showValues ? (
                        format(value)
                      ) : (
                        <span className="sr-only">{format(value)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {legend && (
        <div
          aria-hidden="true"
          className="flex items-center justify-end gap-2 font-primary text-xs text-muted-foreground"
        >
          <span className="tabular-nums">{format(lo)}</span>
          <span
            className="h-2 w-32 rounded-full border border-border"
            style={{
              background: `linear-gradient(to right, ${mix(0)}, ${mix(1)})`,
            }}
          />
          <span className="tabular-nums">{format(hi)}</span>
        </div>
      )}
      {node}
    </div>
  );
}

// ─── Cohort ──────────────────────────────────────────────────────────────────

export interface ChartCohortRow {
  /** Name of the cohort, pinned in the first column (e.g. `"Jun 2025"`). */
  label: string;
  /** Second line under the label, for the cohort's size or any other context (e.g. `"1,563 signups"`). */
  caption?: React.ReactNode;
  /** One value per period, oldest period first. A shorter array simply leaves the later periods empty — the usual triangular shape of a cohort table, where younger cohorts haven't lived through every period yet. */
  values: number[];
}

/** How a cell's shade is chosen: against its own cohort's first period (retention), or against the whole matrix. */
export type ChartCohortShading = "row" | "matrix";

export interface ChartCohortProps
  extends Omit<ChartContainerProps, "size" | "height"> {
  /** One entry per cohort, oldest first — the order they're drawn in, top to bottom. */
  data: ChartCohortRow[];
  /** Column headers, left to right. Defaults to `periodLabel` applied to each period index. */
  periodLabels?: string[];
  /**
   * Builds a column header from its period index when `periodLabels` isn't given.
   * @default (index) => `Month ${index}`
   */
  periodLabel?: (index: number) => string;
  /**
   * Header of the pinned label column.
   * @default "Cohort"
   */
  rowHeaderLabel?: React.ReactNode;
  /**
   * Color of the strongest cell; weaker cells fade toward the canvas.
   * @default CHART_COLORS.blue
   */
  color?: string;
  /**
   * `"row"` shades each cell against its own cohort's first period, so period 0 is always full strength and a
   * row reads as a retention curve. `"matrix"` shades every cell against the whole grid instead, which
   * compares cohorts by absolute size.
   * @default "row"
   */
  shading?: ChartCohortShading;
  /**
   * Appends a row averaging every cohort that reached each period.
   * @default true
   */
  showAverage?: boolean;
  /**
   * Label of the average row.
   * @default "Average"
   */
  averageLabel?: React.ReactNode;
  /**
   * Renders the shading scale under the grid.
   * @default true
   */
  legend?: boolean;
  /**
   * Renders a tooltip on hover.
   * @default true
   */
  tooltip?: boolean;
  /**
   * Formats a value for the cells and the tooltip.
   * @default compact notation (e.g. `1.6k`)
   */
  valueFormatter?: (value: number) => string;
  /**
   * Accessible name of the scroll region.
   * @default "Cohort matrix"
   */
  ariaLabel?: string;
  /**
   * Screen-reader-only text for a cell with no entry.
   * @default "No data"
   */
  noDataLabel?: string;
}

const compactNumber = (value: number) =>
  new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
    notation: "compact",
  })
    .format(value)
    .toLowerCase();

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/**
 * Cohort matrix — one row per cohort, one column per period since it started, with each cell shaded by its
 * value, so a retention curve reads as a fading band across the row and a change between cohorts reads as a
 * change down the column. The triangular shape falls out of the data: give a younger cohort fewer `values` and
 * its later periods stay empty.
 *
 * Built as a real `<table>` (not recharts — there's no continuous scale to draw), so screen readers get every
 * cohort as a row header, every period as a column header, and each cell's value read as text rather than as a
 * color. The label column is pinned while the periods scroll horizontally, and the scroll region is focusable
 * so it can be reached with the keyboard.
 *
 * @example
 * ```tsx
 * <Chart.Cohort
 *   data={[
 *     { caption: "1,563 signups", label: "Jun 2025", values: [1563, 1004, 750, 656] },
 *     { caption: "1,756 signups", label: "Jul 2025", values: [1756, 1141, 860] },
 *   ]}
 *   description="Users still active in each month after signing up."
 *   source="Source: Product analytics"
 *   title="Monthly retention by signup cohort"
 * />
 * ```
 */
function ChartCohort({
  data,
  periodLabels,
  periodLabel = (index) => `Month ${index}`,
  rowHeaderLabel = "Cohort",
  color = CHART_COLORS.blue,
  shading = "row",
  showAverage = true,
  averageLabel = "Average",
  legend = true,
  tooltip = true,
  valueFormatter,
  ariaLabel = "Cohort matrix",
  noDataLabel = "No data",
  className,
  tabIndex,
}: ChartCohortProps) {
  const { ref, show, hide, node } = useCellTooltip();

  const periodCount = data.reduce(
    (widest, row) => Math.max(widest, row.values.length),
    0,
  );
  const columns =
    periodLabels ??
    Array.from({
      length: periodCount,
    }).map((_, index) => periodLabel(index));

  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : compactNumber(value);

  // Averaged over the cohorts that actually reached each period, so a period only younger cohorts haven't
  // lived through yet isn't dragged down by counting them as zero.
  const averages = Array.from({
    length: periodCount,
  }).map((_, index) => {
    const reached = data.filter((row) => row.values[index] !== undefined);
    if (reached.length === 0) return undefined;
    return (
      reached.reduce((total, row) => total + row.values[index], 0) /
      reached.length
    );
  });

  const all = data.flatMap((row) => row.values);
  const lo = all.length > 0 ? Math.min(...all) : 0;
  const hi = all.length > 0 ? Math.max(...all) : 0;

  /** `0…1` intensity of a cell — its share of its own row's first period, or its place in the whole matrix. */
  const strength = (value: number, base: number | undefined) => {
    if (shading === "matrix")
      return hi === lo ? 1 : Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
    if (base === undefined || base === 0) return 1;
    return Math.min(1, Math.max(0, value / base));
  };
  const mix = (t: number) =>
    `color-mix(in oklab, ${color} ${Math.round(8 + 92 * t)}%, var(--background))`;

  const cellProps = (
    value: number,
    base: number | undefined,
    rowLabel: string,
    column: string,
  ) => {
    const t = strength(value, base);
    return {
      onMouseEnter: tooltip
        ? (event: React.MouseEvent<HTMLElement>) =>
            show(
              event,
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    background: mix(t),
                  }}
                />
                <span className="font-medium">
                  {rowLabel} · {column}:
                </span>
                <span>{format(value)}</span>
                {shading === "row" && base !== undefined && base !== 0 && (
                  <span className="text-muted-foreground">
                    ({percent(value / base)})
                  </span>
                )}
              </div>,
            )
        : undefined,
      style: {
        background: mix(t),
        color: t > 0.55 ? CHART_LABEL_ON_FILL_COLOR : "var(--foreground)",
      },
    };
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only clears the hover tooltip when the pointer leaves the chart.
    <div
      className={cn("relative flex w-full flex-col gap-3", className)}
      onMouseLeave={hide}
      ref={ref}
    >
      <section
        aria-label={ariaLabel}
        className={cn(
          "w-full overflow-x-auto",
          "scrollbar-thin [scrollbar-color:var(--border)_transparent]",
          "[&::-webkit-scrollbar]:h-2",
          "[&::-webkit-scrollbar-track]:bg-transparent",
          "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
        // WCAG 2.1.1: the periods scroll sideways, so the region has to be reachable without a pointer.
        tabIndex={tabIndex ?? 0}
      >
        <table className="w-full border-separate border-spacing-1 font-primary text-xs">
          <thead>
            <tr>
              <th
                className="sticky left-0 z-10 min-w-36 bg-background pb-1 text-left font-secondary text-[0.6875rem] font-normal uppercase tracking-wide text-muted-foreground"
                scope="col"
              >
                {rowHeaderLabel}
              </th>
              {columns.map((column) => (
                <th
                  className="min-w-20 pb-1 font-normal text-muted-foreground"
                  key={column}
                  scope="col"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.label}>
                <th
                  className="sticky left-0 z-10 bg-background pr-3 text-left font-normal align-middle"
                  scope="row"
                >
                  <span className="block truncate text-sm font-medium text-foreground">
                    {row.label}
                  </span>
                  {row.caption !== undefined && (
                    <span className="block truncate font-secondary text-xs text-muted-foreground">
                      {row.caption}
                    </span>
                  )}
                </th>
                {columns.map((column, index) => {
                  const value = row.values[index];
                  if (value === undefined)
                    return (
                      <td key={column}>
                        <span className="sr-only">{noDataLabel}</span>
                      </td>
                    );
                  return (
                    <td
                      className="h-10 rounded-md text-center tabular-nums"
                      key={column}
                      {...cellProps(value, row.values[0], row.label, column)}
                    >
                      {format(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {showAverage && (
            <tfoot>
              <tr>
                <th
                  className="sticky left-0 z-10 bg-background pr-3 text-left text-sm font-medium text-foreground"
                  scope="row"
                >
                  {averageLabel}
                </th>
                {columns.map((column, index) => {
                  const value = averages[index];
                  if (value === undefined)
                    return (
                      <td key={column}>
                        <span className="sr-only">{noDataLabel}</span>
                      </td>
                    );
                  return (
                    <td
                      className="h-10 rounded-md text-center tabular-nums"
                      key={column}
                      {...cellProps(
                        value,
                        averages[0],
                        typeof averageLabel === "string"
                          ? averageLabel
                          : "Average",
                        column,
                      )}
                    >
                      {format(value)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </section>
      {legend && (
        <div
          aria-hidden="true"
          className="flex items-center justify-end gap-2 font-primary text-xs text-muted-foreground"
        >
          <span className="tabular-nums">
            {shading === "row" ? percent(0) : format(lo)}
          </span>
          <span
            className="h-2 w-32 rounded-full border border-border"
            style={{
              background: `linear-gradient(to right, ${mix(0)}, ${mix(0.5)}, ${mix(1)})`,
            }}
          />
          <span className="tabular-nums">
            {shading === "row" ? percent(1) : format(hi)}
          </span>
        </div>
      )}
      {node}
    </div>
  );
}

// ─── Waffle ──────────────────────────────────────────────────────────────────

export interface ChartWaffleCategory {
  /** Name of the category, shown in the legend and tooltip. */
  name: string;
  /** Amount of the whole this category holds. Categories are compared with the sum of all values. */
  value: number;
  /** Fill color; falls back to `CHART_PALETTE[index]` when omitted. */
  color?: string;
  /** Fill style for this category; overrides the chart's `pattern`. */
  pattern?: ChartPattern;
}

export interface ChartWaffleProps extends ChartContainerProps {
  /** One entry per category; together they make up the whole. */
  data: ChartWaffleCategory[];
  /**
   * Rows of squares.
   * @default 10
   */
  rows?: number;
  /**
   * Columns of squares. With the defaults, one square is 1% of the whole.
   * @default 10
   */
  columns?: number;
  /**
   * Fill style for every category that doesn't set its own `pattern`.
   * @default "solid"
   */
  pattern?: ChartPattern;
  /**
   * Lists the categories (swatch, name, value and share) beside the grid.
   * @default true
   */
  legend?: boolean;
  /**
   * Renders a tooltip when hovering a square.
   * @default true
   */
  tooltip?: boolean;
  /** Formats a category's value in the legend and tooltip. Defaults to a localized number. */
  valueFormatter?: (value: number) => string;
}

/** Splits `cells` squares between categories in proportion to their values, using largest remainders so the counts always add up to exactly `cells`. */
function allocateCells(values: number[], cells: number): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total === 0) return values.map(() => 0);
  const exact = values.map((value) => (Math.max(0, value) / total) * cells);
  const counts = exact.map(Math.floor);
  let left = cells - counts.reduce((sum, count) => sum + count, 0);
  const order = exact
    .map((share, index) => ({
      index,
      remainder: share - Math.floor(share),
    }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const { index } of order) {
    if (left === 0) break;
    counts[index] += 1;
    left -= 1;
  }
  return counts;
}

/**
 * Waffle chart — the parts of a whole as a grid of squares (by default 100,
 * one per percent), which reads more literally than a pie: "62 of 100".
 * Squares fill from the bottom-left, row by row upward, and are allotted with
 * largest remainders so the grid is always exactly full. One of the compound
 * `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Waffle
 *   data={[{ name: "Agree", value: 62 }, { name: "Disagree", value: 38 }]}
 * />
 * ```
 */
function ChartWaffle({
  data,
  rows = 10,
  columns = 10,
  pattern = "solid",
  legend = true,
  tooltip = true,
  valueFormatter,
  size = "md",
  height,
  className,
}: ChartWaffleProps) {
  const { ref, show, hide, node } = useCellTooltip();
  const cells = rows * columns;
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const counts = allocateCells(
    data.map((item) => item.value),
    cells,
  );
  const format = (value: number) =>
    valueFormatter ? valueFormatter(value) : value.toLocaleString();
  const colorOf = (index: number) =>
    data[index]?.color ?? CHART_PALETTE[index % CHART_PALETTE.length];

  // Category of each square, in fill order (bottom-left, rightwards, then up).
  const owners: number[] = counts.flatMap((count, index) =>
    Array.from<number>({
      length: count,
    }).fill(index),
  );
  const side = height ?? sizeToHeight[size];
  const summary = data
    .map(
      (item) =>
        `${item.name} ${total > 0 ? Math.round((item.value / total) * 100) : 0}%`,
    )
    .join(", ");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: only clears the hover tooltip when the pointer leaves the chart.
    <div
      className={cn(
        "relative flex w-full flex-wrap items-center justify-center gap-x-8 gap-y-4",
        className,
      )}
      onMouseLeave={hide}
      ref={ref}
    >
      <div
        aria-label={`Waffle chart: ${summary}`}
        className="grid shrink-0 gap-0.75"
        role="img"
        style={{
          aspectRatio: `${columns} / ${rows}`,
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          maxWidth: "100%",
          width: side,
        }}
      >
        {Array.from(
          {
            length: cells,
          },
          (_, position) => {
            // Grid cells run top-left → bottom-right; fill starts bottom-left.
            const row = Math.floor(position / columns);
            const column = position % columns;
            const order = (rows - 1 - row) * columns + column;
            const owner = owners[order];
            const category = owner === undefined ? undefined : data[owner];
            const color = owner === undefined ? undefined : colorOf(owner);
            const striped =
              category !== undefined &&
              (category.pattern ?? pattern) === "stripes";
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: hover-only affordance; the categories and shares are listed in the legend and in the chart's aria-label.
              <div
                className="aspect-square rounded-[3px]"
                // biome-ignore lint/suspicious/noArrayIndexKey: squares are positional cells of a fixed grid.
                key={position}
                onMouseEnter={
                  tooltip && category && color
                    ? (event) =>
                        show(
                          event,
                          <div className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="size-2 shrink-0 rounded-full"
                              style={{
                                background: color,
                              }}
                            />
                            <span className="font-medium">
                              {category.name}:
                            </span>
                            <span>{format(category.value)}</span>
                          </div>,
                        )
                    : undefined
                }
                style={{
                  background:
                    color === undefined
                      ? "var(--muted)"
                      : striped
                        ? `repeating-linear-gradient(135deg, transparent 0 3px, ${chartStroke(color, 30)} 3px 4.5px), ${color}`
                        : color,
                  border: `1px solid ${color === undefined ? "var(--border)" : chartStroke(color)}`,
                }}
              />
            );
          },
        )}
      </div>
      {legend && (
        <ul className="flex flex-col gap-2 font-primary text-sm">
          {data.map((item, index) => (
            <li
              className="flex items-center gap-2"
              key={item.name}
            >
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-[3px] border"
                style={{
                  background: colorOf(index),
                  borderColor: chartStroke(colorOf(index)),
                }}
              />
              <span className="font-medium text-foreground">{item.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {format(item.value)}
                {total > 0 && ` · ${Math.round((item.value / total) * 100)}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {node}
    </div>
  );
}

// ─── Stat ────────────────────────────────────────────────────────────────────

const statToneVariants = cva(
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
  {
    defaultVariants: {
      tone: "default",
    },
    variants: {
      /** Icon-chip color, hinting at a good/bad metric (e.g. `"negative"` for churn). */
      tone: {
        default: "bg-muted text-muted-foreground",
        negative: "bg-destructive/10 text-destructive",
        positive: "bg-success/10 text-success",
        warning: "bg-warning/10 text-warning",
      },
    },
  },
);

export type ChartStatTone = "default" | "positive" | "warning" | "negative";

/** Line color of a `Chart.Stat` sparkline when it doesn't set its own `color`, matched to the tile's icon chip. */
const statSparklineColor: Record<ChartStatTone, string> = {
  default: CHART_COLORS.blue,
  negative: "var(--destructive)",
  positive: "var(--success)",
  warning: "var(--warning)",
};

// ─── Sparkline ───────────────────────────────────────────────────────────────

/** How a sparkline draws its values. */
export type ChartSparklineVariant = "area" | "line" | "bar";

export interface ChartSparklineProps {
  /** Values behind the metric, oldest first — typically the last 7/12/30 points. Fewer than two points draws nothing. */
  data: number[];
  /**
   * How the values are drawn: a filled area, a bare line, or small bars.
   * @default "area"
   */
  variant?: ChartSparklineVariant;
  /**
   * Line/fill color — a `CHART_COLORS` entry, a `var(--token)` or any CSS color. Inside a `Chart.Stat` it defaults to the semantic color matching the tile's `tone`.
   * @default CHART_COLORS.blue
   */
  color?: string;
  /**
   * Plot height in pixels. The width always fills the parent.
   * @default 40
   */
  height?: number;
  /**
   * Description announced to screen readers, since the trend has no readable ticks. Without it the plot is
   * marked decorative (`aria-hidden`), which is right when the value it illustrates is already in the text
   * beside it. Inside a `Chart.Stat` it falls back to the tile's label.
   */
  ariaLabel?: string;
  /** Extra classes for the plot's wrapper. */
  className?: string;
}

/** @deprecated Use {@link ChartSparklineVariant}. */
export type ChartStatSparklineVariant = ChartSparklineVariant;

/** @deprecated Use {@link ChartSparklineProps}. */
export type ChartStatSparklineProps = ChartSparklineProps;

/** A sparkline has no axes, so the plot may use the full box; 1px keeps the stroke from being clipped. */
const SPARKLINE_MARGIN = {
  bottom: 1,
  left: 0,
  right: 0,
  top: 1,
} as const;

/**
 * Compact trend plot — no axes, grid, tooltip or legend, just the shape of a metric over time, sized to sit
 * inline next to the number it illustrates (in a `Chart.Stat`, a table cell or a list row). Exposed as
 * `role="img"` with `ariaLabel`, because the series has no readable ticks; without one it's `aria-hidden`.
 * One of the compound `Chart` types; see `Chart` itself for the full set.
 * @example
 * ```tsx
 * <Chart.Sparkline ariaLabel="Revenue, last 7 days" data={[180, 210, 190, 240, 260, 255, 284]} />
 * <Chart.Sparkline color={CHART_COLORS.teal} data={weekly} variant="bar" />
 * ```
 */
function ChartSparkline({
  data,
  variant = "area",
  color = CHART_COLORS.blue,
  height = 40,
  ariaLabel,
  className,
}: ChartSparklineProps) {
  const uid = useChartPatternId();
  const stroke = color;
  const points = React.useMemo(
    () =>
      data.map((value, index) => ({
        index,
        value,
      })),
    [
      data,
    ],
  );

  if (points.length < 2) return null;

  // A labelled trend is a small image; an unlabelled one illustrates text that
  // already carries the meaning, so it's hidden rather than an unnamed graphic.
  const a11y: React.AriaAttributes & {
    role?: "img";
  } =
    ariaLabel === undefined
      ? {
          "aria-hidden": true,
        }
      : {
          "aria-label": ariaLabel,
          role: "img",
        };

  return (
    <div
      className={cn("w-full", className)}
      style={{
        height,
      }}
      {...a11y}
    >
      <ResponsiveContainer
        height="100%"
        width="100%"
      >
        {variant === "bar" ? (
          <RechartsBarChart
            data={points}
            margin={SPARKLINE_MARGIN}
          >
            <Bar
              dataKey="value"
              fill={stroke}
              fillOpacity={0.55}
              isAnimationActive={false}
              radius={[
                2,
                2,
                0,
                0,
              ]}
            />
          </RechartsBarChart>
        ) : variant === "line" ? (
          <RechartsLineChart
            data={points}
            margin={SPARKLINE_MARGIN}
          >
            <Line
              dataKey="value"
              dot={false}
              isAnimationActive={false}
              stroke={stroke}
              strokeWidth={1.5}
              type="monotone"
            />
          </RechartsLineChart>
        ) : (
          <RechartsAreaChart
            data={points}
            margin={SPARKLINE_MARGIN}
          >
            <defs>
              <linearGradient
                id={`chart-sparkline-${uid}`}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={stroke}
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor={stroke}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <Area
              dataKey="value"
              dot={false}
              fill={`url(#chart-sparkline-${uid})`}
              isAnimationActive={false}
              stroke={stroke}
              strokeWidth={1.5}
              type="monotone"
            />
          </RechartsAreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ─── Stat ────────────────────────────────────────────────────────────────────

export interface ChartStatProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Short metric name, e.g. "Active customers". */
  label: string;
  /** Pre-formatted value, e.g. "128" or "$4,820.00". */
  value: string;
  /** Icon rendered in the tone-colored chip. */
  icon: React.ReactNode;
  /** Short supporting text below the value. */
  hint?: string;
  /** Plain-language meaning of this stat and how it's calculated, shown in a tooltip. */
  description?: string;
  /**
   * Tone of the icon chip.
   * @default "default"
   */
  tone?: ChartStatTone;
  /** Shows a pulsing skeleton instead of the value/hint while the underlying data is loading. */
  isLoading?: boolean;
  /**
   * Optional `Chart.Sparkline` drawn at the bottom of the tile, from the raw values behind the metric. Omit
   * it and the tile renders exactly as before. Its `color` defaults to the semantic color matching `tone`,
   * and its `ariaLabel` to `"<label> trend"`.
   */
  sparkline?: ChartSparklineProps;
}

/**
 * KPI tile — a single metric with an icon chip, typically shown alongside a
 * `Chart.*` in a dashboard. One of the compound `Chart` types; see `Chart`
 * itself for the full set.
 * @example
 * ```tsx
 * <Chart.Stat icon={<Icon icon={Users} size="sm" />} label="Active customers" value="128" />
 * <Chart.Stat
 *   icon={<Icon icon={Users} size="sm" />}
 *   label="Active customers"
 *   sparkline={{ data: [180, 210, 190, 240, 260, 255, 284] }}
 *   value="1,284"
 * />
 * ```
 */
function ChartStat({
  label,
  value,
  icon,
  hint,
  description,
  tone = "default",
  isLoading = false,
  sparkline,
  className,
  ...props
}: ChartStatProps) {
  return (
    <Card
      className={cn("gap-3 p-4", className)}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate font-primary text-sm font-medium text-muted-foreground">
            {label}
          </p>
          {description && <IconTooltip description={description} />}
        </div>
        <div
          className={statToneVariants({
            tone,
          })}
        >
          {icon}
        </div>
      </div>
      {isLoading ? (
        <div className="h-7 w-20 animate-pulse rounded-md bg-muted" />
      ) : (
        <p className="font-primary text-2xl font-bold text-foreground">
          {value}
        </p>
      )}
      {isLoading ? (
        <div className="h-3.5 w-28 animate-pulse rounded-md bg-muted" />
      ) : (
        hint && (
          <p className="font-primary text-xs text-muted-foreground">{hint}</p>
        )
      )}
      {sparkline &&
        (isLoading ? (
          <div
            className="w-full animate-pulse rounded-md bg-muted"
            style={{
              height: sparkline.height ?? 40,
            }}
          />
        ) : (
          <ChartSparkline
            {...sparkline}
            ariaLabel={sparkline.ariaLabel ?? `${label} trend`}
            color={sparkline.color ?? statSparklineColor[tone]}
          />
        ))}
    </Card>
  );
}

/**
 * Compound chart set — `Area`/`Bar`/`Line`/`Donut`/`Dumbbell`/`Funnel`/`Gantt`/`Heatmap`/`Histogram`/`Cohort`/`Waffle`/`Waterfall`/`Needle`/`PositiveNegative`/`Pyramid`/`Radar`/`Sankey`/`BoxPlot`/`Candlestick`/`Scatter`/`TreeMap`
 * (each a `recharts`-backed chart type; `BoxPlot`, `Candlestick`, `Histogram`, `Waterfall`, `Dumbbell` and `Gantt` draw their own glyphs on recharts' scales, while `Heatmap` and `Cohort` are real `<table>`s) plus `Stat` (a KPI tile commonly shown
 * alongside them in a dashboard) and `Sparkline` (an axis-less inline trend, used on its own or inside a
 * `Stat`). `Bar` and `Area` also take `stack="percent"` to normalize a stack to 100%. Every chart shares the pastel
 * `CHART_PALETTE` (light/dark `--chart-*` tokens, overridable per series with
 * `color`), an opt-in diagonal-stripe `pattern` for filled marks, and the same
 * grid/axis/tooltip styling built from this library's color tokens
 * (never a hardcoded hex), and a `ChartContainer` wrapper that's `w-full` —
 * combined with `recharts`' `ResponsiveContainer`, every chart is fluid at
 * any viewport width. `size`/`height` pick the fixed pixel height
 * `ResponsiveContainer` needs. Every chart (not `Stat`, which is a tile)
 * also takes `title`, `description`, `source` and `note` — laid out like a
 * Datawrapper embed: bold title, muted description, the chart, then a hairline
 * and small source/note lines. Setting any of them wraps the chart in a
 * `<figure>`.
 * @example
 * ```tsx
 * <Chart.Area areas={[{ dataKey: "revenue" }]} data={data} xAxisKey="month" />
 * <Chart.Bar bars={[{ dataKey: "signups" }]} data={data} xAxisKey="month" />
 * <Chart.Donut centerLabel="Total" centerValue="1,204" data={sliceData} />
 * ```
 */
export const Chart = {
  Area: withChartFrame(ChartArea),
  Bar: withChartFrame(ChartBar),
  BoxPlot: withChartFrame(ChartBoxPlot),
  Candlestick: withChartFrame(ChartCandlestick),
  Cohort: withChartFrame(ChartCohort),
  Donut: withChartFrame(ChartDonut),
  Dumbbell: withChartFrame(ChartDumbbell),
  Funnel: withChartFrame(ChartFunnel),
  Gantt: withChartFrame(ChartGantt),
  Heatmap: withChartFrame(ChartHeatmap),
  Histogram: withChartFrame(ChartHistogram),
  Line: withChartFrame(ChartLine),
  Needle: withChartFrame(ChartNeedle),
  PositiveNegative: withChartFrame(ChartPositiveNegative),
  Pyramid: withChartFrame(ChartPyramid),
  Radar: withChartFrame(ChartRadar),
  Sankey: withChartFrame(ChartSankey),
  Scatter: withChartFrame(ChartScatter),
  Sparkline: ChartSparkline,
  Stat: ChartStat,
  TreeMap: withChartFrame(ChartTreeMap),
  Waffle: withChartFrame(ChartWaffle),
  Waterfall: withChartFrame(ChartWaterfall),
};
