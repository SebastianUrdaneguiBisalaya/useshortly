/**
 * Row and time-axis preparation for `Chart.Gantt`: dated tasks in, pixel-ready
 * rows plus an aligned time axis out. The hard part of a Gantt chart isn't the
 * bars, it's the axis — a span of three days and a span of three years need
 * different tick steps, and ticks that don't land on real day/month boundaries
 * make the whole chart unreadable. Free of React and recharts so it can be
 * unit-tested on its own.
 */

/** Anything a task's dates can be given as: a `Date`, epoch milliseconds, or a string `Date` can parse (e.g. `"2026-03-01"`). */
export type GanttDateLike = Date | number | string;

/** Granularity of the time axis, picked from the span of the tasks. */
export type GanttStep = "day" | "hour" | "month" | "quarter" | "week" | "year";

/** Which key the rows are ordered by. `"none"` keeps the caller's order. */
export type GanttSort = "duration" | "end" | "name" | "none" | "start";

export interface GanttTaskInput {
  /** Task label on the category axis. Must be unique — it's how `dependsOn` refers to a task. */
  name: string;
  /** When the task begins. */
  start: GanttDateLike;
  /** When the task ends. Ignored for a `milestone`, which is a single point in time. */
  end?: GanttDateLike;
  /** Share of the task already done, `0`–`1`. Values outside that range are clamped; omit it to draw a plain bar with no progress fill. */
  progress?: number;
  /** Phase/workstream this task belongs to. Tasks are kept together by group, and the group names become the legend. */
  group?: string;
  /** Draws the task as a single diamond at `start` instead of a bar — a deadline, a launch, a sign-off. */
  milestone?: boolean;
  /** Name(s) of the task(s) this one follows. Each resolved pair is drawn as a connector from the predecessor's end to this task's start. */
  dependsOn?: readonly string[] | string;
  /** Color of the bar, overriding the group/default color. A `CHART_COLORS` entry, a `var(--token)` or any CSS color. */
  color?: string;
}

export interface GanttRow
  extends Omit<GanttTaskInput, "dependsOn" | "end" | "start"> {
  /** Start as epoch milliseconds. */
  start: number;
  /** End as epoch milliseconds; equal to `start` for a milestone. */
  end: number;
  /** `end - start` in milliseconds; `0` for a milestone. */
  duration: number;
  /** Progress clamped to `0`–`1`, or `undefined` when the task doesn't report any. */
  progress?: number;
  milestone: boolean;
  /** Predecessor names, always as an array (empty when the task has none). */
  dependsOn: string[];
  /** Position of the row in drawing order, top to bottom. */
  index: number;
}

/** A resolved `dependsOn` pair, as row positions — the caller draws a connector between the two rows. */
export interface GanttLink {
  /** Row index of the predecessor. */
  from: number;
  /** Row index of the dependent task. */
  to: number;
}

/** A run of consecutive rows sharing a `group`, for separators and the legend. */
export interface GanttGroup {
  name: string;
  /** Row index of the group's first row. */
  firstRow: number;
  /** Row index of the group's last row. */
  lastRow: number;
}

export interface GanttOptions {
  /**
   * Key the rows are ordered by.
   * @default "none"
   */
  sort?: GanttSort;
  /**
   * Direction of that order. For `"name"`, `"asc"` is A→Z.
   * @default "asc"
   */
  order?: "asc" | "desc";
  /**
   * Number of time-axis ticks to aim for. The step is picked so the real count
   * lands near it on a natural boundary (hour, day, week, month, quarter, year).
   * @default 6
   */
  ticks?: number;
}

export interface GanttResult {
  rows: GanttRow[];
  /** `[min start, max end]` as epoch milliseconds, widened to the tick step's boundaries. */
  domain: [
    number,
    number,
  ];
  /** Tick positions as epoch milliseconds, aligned to `step`. */
  ticks: number[];
  /** Granularity the ticks were built at. */
  step: GanttStep;
  links: GanttLink[];
  /** Groups in row order; empty when no task declares a `group`. */
  groups: GanttGroup[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Milliseconds one step spans, used only to choose between steps (a month is approximated). */
const STEP_SPAN: Record<GanttStep, number> = {
  day: DAY,
  hour: HOUR,
  month: 30 * DAY,
  quarter: 91 * DAY,
  week: 7 * DAY,
  year: 365 * DAY,
};

const STEPS: GanttStep[] = [
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
];

/** Epoch milliseconds for a `Date`, a number, or a parsable date string; `NaN` when it isn't a real date. */
export function toTime(value: GanttDateLike): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return new Date(value).getTime();
}

/** Start of the `step` the given instant falls in (local time), so ticks land on real day/month/year boundaries rather than on an arbitrary offset from the first task. */
export function floorTime(time: number, step: GanttStep): number {
  const date = new Date(time);
  date.setMilliseconds(0);
  date.setSeconds(0);
  date.setMinutes(0);
  if (step === "hour") return date.getTime();
  date.setHours(0);
  if (step === "day") return date.getTime();
  if (step === "week") {
    // Weeks start on Monday, the convention every project plan is read in.
    const weekday = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - weekday);
    return date.getTime();
  }
  date.setDate(1);
  if (step === "month") return date.getTime();
  if (step === "quarter") {
    date.setMonth(Math.floor(date.getMonth() / 3) * 3);
    return date.getTime();
  }
  date.setMonth(0);
  return date.getTime();
}

/** The instant one `step` after `time`, walked with calendar arithmetic so month and year steps keep their real (uneven) lengths. */
export function addStep(time: number, step: GanttStep, count = 1): number {
  const date = new Date(time);
  switch (step) {
    case "hour":
      date.setHours(date.getHours() + count);
      break;
    case "day":
      date.setDate(date.getDate() + count);
      break;
    case "week":
      date.setDate(date.getDate() + 7 * count);
      break;
    case "month":
      date.setMonth(date.getMonth() + count);
      break;
    case "quarter":
      date.setMonth(date.getMonth() + 3 * count);
      break;
    default:
      date.setFullYear(date.getFullYear() + count);
  }
  return date.getTime();
}

/**
 * Coarsest step that still fits `target` ticks into `span`, plus how many of
 * those steps to put between two ticks — so a three-day plan is ticked in
 * hours, a month in a few days, and a three-year plan in quarters, always
 * landing near `target` ticks instead of hundreds of them.
 */
function pickStep(
  span: number,
  target: number,
): {
  step: GanttStep;
  every: number;
} {
  const step =
    STEPS.findLast((candidate) => span / STEP_SPAN[candidate] >= target) ??
    "hour";
  return {
    every: Math.max(1, Math.round(span / STEP_SPAN[step] / target)),
    step,
  };
}

/**
 * Tick positions covering `[from, to]`, aligned to `step`'s natural boundaries
 * and inclusive of the boundary at or past `to`, so the axis always closes off
 * after the last task instead of stopping inside it.
 */
export function timeTicks(
  from: number,
  to: number,
  step: GanttStep,
  every = 1,
): number[] {
  const ticks: number[] = [];
  let tick = floorTime(from, step);
  // A degenerate span still deserves a closing tick, hence the `<=`.
  while (tick <= to) {
    ticks.push(tick);
    tick = addStep(tick, step, every);
  }
  ticks.push(tick);
  return ticks;
}

const TICK_FORMATS: Record<GanttStep, Intl.DateTimeFormatOptions> = {
  day: {
    day: "numeric",
    month: "short",
  },
  hour: {
    hour: "numeric",
    minute: "2-digit",
  },
  month: {
    month: "short",
  },
  quarter: {
    month: "short",
    year: "2-digit",
  },
  week: {
    day: "numeric",
    month: "short",
  },
  year: {
    year: "numeric",
  },
};

/** Default label for a time-axis tick at the given granularity — a clock time for `"hour"`, `"3 Mar"` for days and weeks, the month or year above that. */
export function formatGanttTick(time: number, step: GanttStep): string {
  return new Date(time).toLocaleDateString(undefined, TICK_FORMATS[step]);
}

/** Default label for a task's own dates in a tooltip: day and month, plus the year when the task doesn't sit in the current one. */
export function formatGanttDate(time: number): string {
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}

/** A task's length in whole days, rounded up, for a duration label. A milestone has no length and yields `0`. */
export function durationInDays(duration: number): number {
  return Math.ceil(duration / DAY);
}

/** Numeric value a task is ordered by, for every sort but `"name"` (which compares strings) and `"none"`. */
const sortValue: Record<
  Exclude<GanttSort, "name" | "none">,
  (task: { start: number; end: number }) => number
> = {
  duration: (task) => task.end - task.start,
  end: (task) => task.end,
  start: (task) => task.start,
};

/**
 * Turns dated tasks into rows with numeric bounds, a time axis to draw them
 * against, resolved dependency pairs, and the groups the rows fall into.
 *
 * A task whose dates aren't real is dropped — there's no bar to draw. A task
 * ending before it starts is treated as zero-length rather than drawn
 * backwards, and a `milestone` is always zero-length at its `start`. Rows are
 * kept together by `group` (groups appear in the order their first task does),
 * and sorting happens inside each group so a phase never gets split up. A
 * `dependsOn` naming a task that isn't in the set is ignored. An empty set
 * yields no rows and a placeholder day-wide domain.
 *
 * @example
 * ```ts
 * buildGantt([
 *   { end: "2026-03-10", name: "Design", start: "2026-03-01" },
 *   { dependsOn: "Design", end: "2026-03-24", name: "Build", start: "2026-03-10" },
 * ]);
 * // rows in order, ticks on real day boundaries, one link Design → Build
 * ```
 */
export function buildGantt(
  tasks: readonly GanttTaskInput[],
  { sort = "none", order = "asc", ticks: target = 6 }: GanttOptions = {},
): GanttResult {
  const parsed = tasks
    .map((task) => {
      const start = toTime(task.start);
      const end = task.milestone ? start : toTime(task.end ?? task.start);
      return {
        ...task,
        dependsOn:
          task.dependsOn === undefined
            ? []
            : typeof task.dependsOn === "string"
              ? [
                  task.dependsOn,
                ]
              : [
                  ...task.dependsOn,
                ],
        end: Math.max(start, end),
        milestone: task.milestone ?? false,
        progress:
          task.progress === undefined
            ? undefined
            : Math.min(1, Math.max(0, task.progress)),
        start,
      };
    })
    .filter((task) => Number.isFinite(task.start) && Number.isFinite(task.end));

  if (parsed.length === 0) {
    const from = floorTime(Date.now(), "day");
    return {
      domain: [
        from,
        from + DAY,
      ],
      groups: [],
      links: [],
      rows: [],
      step: "day",
      ticks: [
        from,
        from + DAY,
      ],
    };
  }

  // Group order follows first appearance, so the caller's phase order is kept
  // even when the rows inside a phase are sorted.
  const sign = order === "asc" ? 1 : -1;
  const groupNames: string[] = [];
  for (const task of parsed) {
    const key = task.group ?? "";
    if (!groupNames.includes(key)) groupNames.push(key);
  }

  const rows: GanttRow[] = [];
  const groups: GanttGroup[] = [];
  for (const name of groupNames) {
    const members = parsed.filter((task) => (task.group ?? "") === name);
    if (sort !== "none") {
      // `Array.prototype.sort` is stable, so ties keep their input order.
      members.sort((a, b) =>
        sort === "name"
          ? sign * a.name.localeCompare(b.name)
          : sign * (sortValue[sort](a) - sortValue[sort](b)),
      );
    }
    const firstRow = rows.length;
    for (const task of members) {
      rows.push({
        ...task,
        duration: task.end - task.start,
        index: rows.length,
      });
    }
    if (name !== "")
      groups.push({
        firstRow,
        lastRow: rows.length - 1,
        name,
      });
  }

  const position = new Map(
    rows.map((row) => [
      row.name,
      row.index,
    ]),
  );
  const links: GanttLink[] = [];
  for (const row of rows)
    for (const predecessor of row.dependsOn) {
      const from = position.get(predecessor);
      if (from === undefined || from === row.index) continue;
      links.push({
        from,
        to: row.index,
      });
    }

  const min = Math.min(...rows.map((row) => row.start));
  const max = Math.max(...rows.map((row) => row.end));
  const { step, every } = pickStep(Math.max(max - min, HOUR), target);
  const axis = timeTicks(min, max, step, every);

  return {
    domain: [
      axis[0] as number,
      axis[axis.length - 1] as number,
    ],
    groups,
    links,
    rows,
    step,
    ticks: axis,
  };
}
