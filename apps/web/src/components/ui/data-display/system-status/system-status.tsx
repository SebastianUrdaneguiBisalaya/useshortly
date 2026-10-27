"use client";

import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";

import { IconTooltip } from "../../overlays-feedback/tooltip/tooltip";
import { cn } from "../../utils/tailwind/cn";

/** One status level of the chart (e.g. "Operational"). */
export interface SystemStatusLevel {
  /** Unique identifier that data points reference through their `level` field. */
  value: string;
  /** Human-readable name, shown in the legend and in each bar's popover. */
  label: string;
  /** Any CSS color used to paint the bar and its swatch. Prefer a token, e.g. `"var(--success)"`, so it re-colors with the theme. */
  color: string;
}

/** Status of a single day. Days without a point use `SystemStatus`'s `defaultLevel`. */
export interface SystemStatusPoint {
  /** The day, as a `Date` or an ISO `"YYYY-MM-DD"` string. */
  date: Date | string;
  /** `value` of one of the `levels`. Unknown values fall back to `defaultLevel`. */
  level: string;
  /** Optional detail shown in the popover, e.g. "Elevated API latency in eu-west". */
  description?: string;
}

interface DayEntry {
  readonly date: Date;
  readonly level: SystemStatusLevel;
  readonly description?: string;
}

interface SystemStatusContextValue {
  readonly levels: readonly SystemStatusLevel[];
  readonly days: readonly DayEntry[];
  readonly locale?: string;
  readonly hasCustomEnd: boolean;
}

const SystemStatusContext =
  React.createContext<SystemStatusContextValue | null>(null);

function useSystemStatusContext() {
  const context = React.useContext(SystemStatusContext);
  if (!context) {
    throw new Error(
      "SystemStatus subcomponents must be used within <SystemStatus>.",
    );
  }
  return context;
}

function startOfDay(value: Date | string) {
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export interface SystemStatusProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** `SystemStatus.Title`, `Description`, `Chart` and `Legend` pieces, in any order. */
  children: React.ReactNode;
  /** Status levels the chart can show, in the order the legend lists them. Define as many as you need, with your own labels and colors. */
  levels: readonly SystemStatusLevel[];
  /** Daily statuses. Only days that differ from `defaultLevel` need an entry. */
  data: readonly SystemStatusPoint[];
  /**
   * Number of days the chart covers, ending at `endDate` (e.g. `90` or `180`). On narrow screens `SystemStatus.Chart` shows only the most recent days that fit.
   * @default 90
   */
  days?: number;
  /**
   * Last day of the range. Defaults to today.
   * @default today
   */
  endDate?: Date | string;
  /** `value` of the level used for days that have no entry in `data`. @default the first level's value */
  defaultLevel?: string;
  /** BCP 47 locale used to format dates in the popovers. Defaults to the browser's. */
  locale?: string;
}

/**
 * Root of the compound status-history chart — the "uptime bars" a SaaS shows
 * on its status page, one bar per day colored by that day's status. Levels,
 * labels, colors and the covered range are all defined by props.
 * @example
 * ```tsx
 * <SystemStatus days={90} data={incidents} levels={levels}>
 *   <SystemStatus.Title info="Uptime of the public API">API</SystemStatus.Title>
 *   <SystemStatus.Chart />
 *   <SystemStatus.Legend />
 * </SystemStatus>
 * ```
 */
function SystemStatusRoot({
  levels,
  data,
  days: range = 90,
  endDate,
  defaultLevel,
  locale,
  className,
  children,
  ...props
}: SystemStatusProps) {
  const endTime = endDate ? startOfDay(endDate).getTime() : undefined;
  const fallbackValue = defaultLevel ?? levels[0]?.value;

  const entries = React.useMemo<readonly DayEntry[]>(() => {
    const byValue = new Map(
      levels.map((level) => [
        level.value,
        level,
      ]),
    );
    const fallback = fallbackValue ? byValue.get(fallbackValue) : undefined;
    if (!fallback) return [];

    const byDay = new Map<string, SystemStatusPoint>();
    for (const point of data) byDay.set(dayKey(startOfDay(point.date)), point);

    const end =
      endTime === undefined ? startOfDay(new Date()) : new Date(endTime);
    const count = Math.max(1, Math.floor(range));

    return Array.from(
      {
        length: count,
      },
      (_, index) => {
        const date = new Date(
          end.getFullYear(),
          end.getMonth(),
          end.getDate() - (count - 1 - index),
        );
        const point = byDay.get(dayKey(date));
        return {
          date,
          description: point?.description,
          level: (point && byValue.get(point.level)) || fallback,
        };
      },
    );
  }, [
    data,
    endTime,
    fallbackValue,
    levels,
    range,
  ]);

  const value = React.useMemo<SystemStatusContextValue>(
    () => ({
      days: entries,
      hasCustomEnd: endTime !== undefined,
      levels,
      locale,
    }),
    [
      endTime,
      entries,
      levels,
      locale,
    ],
  );

  return (
    <SystemStatusContext.Provider value={value}>
      <div
        className={cn(
          "flex w-full flex-col gap-3 rounded-lg border border-border bg-background p-4",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </SystemStatusContext.Provider>
  );
}

export interface SystemStatusTitleProps
  extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Name of the service (e.g. "API"). */
  children: React.ReactNode;
  /** Text shown in a popover when hovering or focusing the info icon next to the title. Omit it to render no icon. */
  info?: string;
  /** Icon of the info button. Defaults to a help-circle. */
  infoIcon?: LucideIcon;
}

/** Heading (`h3`) of the block, with an optional info icon that reveals `info` in a popover on hover, focus or click. */
function SystemStatusTitle({
  info,
  infoIcon,
  className,
  children,
  ...props
}: SystemStatusTitleProps) {
  return (
    <div className="flex items-center gap-1.5">
      <h3
        className={cn(
          "font-primary text-sm font-medium text-foreground",
          className,
        )}
        {...props}
      >
        {children}
      </h3>
      {info && (
        <IconTooltip
          description={info}
          icon={infoIcon}
        />
      )}
    </div>
  );
}

export interface SystemStatusDescriptionProps
  extends React.HTMLAttributes<HTMLParagraphElement> {
  /** Supporting copy under the title, e.g. the current status. */
  children: React.ReactNode;
}

/** Optional supporting text under the title. */
function SystemStatusDescription({
  className,
  ...props
}: SystemStatusDescriptionProps) {
  return (
    <p
      className={cn(
        "-mt-2 font-primary text-sm text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

const POPOVER_GAP = 8;

export interface SystemStatusChartProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /**
   * Height of the bars in pixels.
   * @default 40
   */
  height?: number;
  /**
   * Space between bars in pixels.
   * @default 2
   */
  gap?: number;
  /**
   * Narrowest a bar may get, in pixels. When the container can't fit every day at this width, only the most recent days that fit are drawn, so the chart stays readable on small screens.
   * @default 4
   */
  minBarWidth?: number;
  /**
   * Shows the labels under the chart's left and right edges.
   * @default true
   */
  showRangeLabels?: boolean;
  /** Label under the first visible bar. Defaults to "N days ago". */
  startLabel?: React.ReactNode;
  /** Label under the last visible bar. Defaults to "Today", or the formatted `endDate` when one is set. */
  endLabel?: React.ReactNode;
}

/**
 * The bar chart itself: an SVG with one bar per day, sized to its container.
 * Hovering (or touching) a bar shows a popover with the date, level and
 * description. It is also keyboard-operable: focus it, then use the arrow
 * keys, Home and End to move between days; Escape dismisses the popover.
 */
function SystemStatusChart({
  height = 40,
  gap = 2,
  minBarWidth = 4,
  showRangeLabels = true,
  startLabel,
  endLabel,
  className,
  "aria-label": ariaLabel,
  ...props
}: SystemStatusChartProps) {
  const { days, locale, hasCustomEnd } = useSystemStatusContext();
  const uid = React.useId();
  const popoverId = `${uid}-popover`;
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties>({
    opacity: 0,
    pointerEvents: "none",
    position: "fixed",
  });

  React.useLayoutEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fits =
    width > 0
      ? Math.max(1, Math.floor((width + gap) / (minBarWidth + gap)))
      : 0;
  const count = Math.min(days.length, fits);
  const visible = days.slice(days.length - count);
  const barWidth = count > 0 ? (width - gap * (count - 1)) / count : 0;
  const step = barWidth + gap;
  const active = activeIndex === null ? undefined : visible[activeIndex];

  const dateFormat = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
      }),
    [
      locale,
    ],
  );

  const computePopover = React.useCallback(() => {
    const svg = svgRef.current;
    const popover = popoverRef.current;
    if (!svg || !popover || activeIndex === null) return;

    const svgRect = svg.getBoundingClientRect();
    // Layout size: unaffected by the popover's open-animation scale.
    const popoverRect = {
      height: popover.offsetHeight,
      width: popover.offsetWidth,
    };
    const centerX = svgRect.left + activeIndex * step + barWidth / 2;
    const left = Math.min(
      Math.max(POPOVER_GAP, centerX - popoverRect.width / 2),
      window.innerWidth - POPOVER_GAP - popoverRect.width,
    );
    const fitsAbove = svgRect.top - POPOVER_GAP >= popoverRect.height;

    setPopoverStyle({
      left,
      position: "fixed",
      top: fitsAbove
        ? svgRect.top - POPOVER_GAP - popoverRect.height
        : svgRect.bottom + POPOVER_GAP,
    });
  }, [
    activeIndex,
    barWidth,
    step,
  ]);

  React.useLayoutEffect(() => {
    if (activeIndex === null) return;
    computePopover();
    window.addEventListener("scroll", computePopover, true);
    window.addEventListener("resize", computePopover);
    return () => {
      window.removeEventListener("scroll", computePopover, true);
      window.removeEventListener("resize", computePopover);
    };
  }, [
    activeIndex,
    computePopover,
  ]);

  // Touch has no "leave": dismiss on a tap anywhere outside the chart.
  React.useEffect(() => {
    if (activeIndex === null) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setActiveIndex(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [
    activeIndex,
  ]);

  const indexFromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - rect.left) / step);
    return Math.min(Math.max(index, 0), count - 1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const current = activeIndex ?? count;
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = Math.max(0, current - 1);
        break;
      case "ArrowRight":
        next = Math.min(count - 1, current + 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      case "Escape":
        setActiveIndex(null);
        return;
      default:
        return;
    }
    event.preventDefault();
    setActiveIndex(next);
  };

  const first = visible[0];
  const last = visible[visible.length - 1];

  return (
    <div
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    >
      <div
        aria-activedescendant={
          activeIndex === null ? undefined : `${uid}-bar-${activeIndex}`
        }
        aria-describedby={active ? popoverId : undefined}
        aria-label={
          ariaLabel ??
          `Status history for the last ${days.length} days. Use the arrow keys to move between days.`
        }
        aria-orientation="horizontal"
        aria-readonly="true"
        className="rounded-sm focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!"
        onBlur={() => setActiveIndex(null)}
        onKeyDown={handleKeyDown}
        ref={wrapperRef}
        role="listbox"
        style={{
          height,
        }}
        tabIndex={0}
      >
        {count > 0 && (
          <svg
            className="block touch-pan-y"
            height={height}
            onPointerDown={(event) => setActiveIndex(indexFromPointer(event))}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setActiveIndex(null);
            }}
            onPointerMove={(event) => setActiveIndex(indexFromPointer(event))}
            ref={svgRef}
            role="presentation"
            width={width}
          >
            {visible.map((entry, index) => (
              <rect
                aria-label={`${dateFormat.format(entry.date)}: ${entry.level.label}`}
                aria-selected={index === activeIndex}
                fill={entry.level.color}
                height={height}
                id={`${uid}-bar-${index}`}
                key={entry.date.getTime()}
                opacity={
                  activeIndex === null || index === activeIndex ? 1 : 0.5
                }
                role="option"
                rx={Math.min(2, barWidth / 2)}
                width={barWidth}
                x={index * step}
                y={0}
              />
            ))}
          </svg>
        )}
      </div>

      {showRangeLabels && first && last && (
        <div className="flex justify-between font-primary text-xs text-muted-foreground">
          <span>{startLabel ?? `${count} days ago`}</span>
          <span>
            {endLabel ??
              (hasCustomEnd ? dateFormat.format(last.date) : "Today")}
          </span>
        </div>
      )}

      {active &&
        createPortal(
          <div
            className="z-50 flex max-w-xs animate-fade-scale-in flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2 font-primary text-xs text-foreground shadow-lg"
            id={popoverId}
            ref={popoverRef}
            role="tooltip"
            style={popoverStyle}
          >
            <span className="font-medium">
              {dateFormat.format(active.date)}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: active.level.color,
                }}
              />
              {active.level.label}
            </span>
            {active.description && (
              <span className="leading-relaxed text-muted-foreground">
                {active.description}
              </span>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Texts rendered by `SystemStatus.Legend`. Pass `lang` to override any of them. */
export interface SystemStatusLegendLang {
  /** Accessible label for the legend. */
  statusLevels: string;
}

/** English defaults for `SystemStatusLegendLang`. */
export const defaultSystemStatusLegendLang: SystemStatusLegendLang = {
  statusLevels: "Status levels",
};

export interface SystemStatusLegendProps
  extends Omit<React.HTMLAttributes<HTMLUListElement>, "lang"> {
  /**
   * Texts rendered by this component. Merges over English defaults.
   * @default defaultSystemStatusLegendLang
   */
  lang?: Partial<SystemStatusLegendLang>;
}

/** Swatch + label for each level, so the meaning of a color is never conveyed by color alone. */
function SystemStatusLegend({
  className,
  lang,
  ...props
}: SystemStatusLegendProps) {
  const resolvedLang = { ...defaultSystemStatusLegendLang, ...lang };
  const { levels } = useSystemStatusContext();

  return (
    <ul
      aria-label={resolvedLang.statusLevels}
      className={cn(
        "flex flex-wrap gap-x-4 gap-y-1 font-primary text-xs text-muted-foreground",
        className,
      )}
      {...props}
    >
      {levels.map((level) => (
        <li
          className="flex items-center gap-1.5"
          key={level.value}
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{
              backgroundColor: level.color,
            }}
          />
          {level.label}
        </li>
      ))}
    </ul>
  );
}

export const SystemStatus = Object.assign(SystemStatusRoot, {
  Chart: SystemStatusChart,
  Description: SystemStatusDescription,
  Legend: SystemStatusLegend,
  Title: SystemStatusTitle,
});
