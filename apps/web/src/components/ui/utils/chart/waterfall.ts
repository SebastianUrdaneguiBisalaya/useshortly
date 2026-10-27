/**
 * Layout for `Chart.Waterfall`: signed steps in, the floating bars of a bridge out. Each bar starts where the
 * previous one ended, which is the whole point of the form and the one thing a plain bar chart can't do. Free
 * of React and recharts so the running total can be unit-tested on its own.
 */

/** Whether a step moves the running total or states an absolute level. */
export type WaterfallStepKind = "delta" | "total";

export interface WaterfallStepInput {
  /** Category label on the axis, e.g. `"New business"`. */
  name: string;
  /** For a `"delta"` step, the signed change it contributes. For a `"total"` step, the absolute level it stands at. */
  value: number;
  /**
   * `"delta"` floats on the running total; `"total"` is an anchor drawn from zero that also *resets* the
   * running total, which is how an opening balance or a mid-bridge subtotal is expressed.
   * @default "delta"
   */
  kind?: WaterfallStepKind;
  /** Color override for this bar; otherwise the chart colors it by direction. */
  color?: string;
}

/** Which way a bar moves, for coloring it. `"total"` is an anchor, not a movement. */
export type WaterfallDirection = "down" | "flat" | "total" | "up";

export interface WaterfallStep {
  /**
   * Unique category key. A bridge legitimately repeats a label — "Hires" on both sides of a subtotal — and a
   * category axis can't tell two identical values apart, so the axis is keyed by this and labelled by `name`.
   */
  key: string;
  name: string;
  /** Value the bar starts at (its base). */
  from: number;
  /** Value the bar ends at (its tip). */
  to: number;
  /** Signed contribution; zero on a `"total"`, which states a level rather than a change. */
  delta: number;
  /** Running total once this step is applied — the same as `to`, exposed under the name the tooltip wants. */
  cumulative: number;
  kind: WaterfallStepKind;
  direction: WaterfallDirection;
  /** The input's `color`, passed through untouched. */
  color?: string;
}

export interface WaterfallOptions {
  /** Appends a closing anchor bar with this label, drawn from zero to the final running total. Omit for a bridge that ends on its last delta. */
  total?: string;
}

export interface WaterfallResult {
  steps: WaterfallStep[];
  /** `[min, max]` across every bar, always including zero — a bridge that never returns to its baseline still has to show it. */
  domain: [
    number,
    number,
  ];
}

/**
 * Turns steps into floating bars with a running total.
 *
 * A step with a non-finite `value` can't be placed on the bridge, so it's dropped rather than propagating
 * `NaN` through every bar after it. An empty sequence yields no bars and a placeholder domain.
 *
 * @example
 * ```ts
 * buildWaterfall(
 *   [
 *     { kind: "total", name: "Q1", value: 100 },
 *     { name: "New", value: 40 },
 *     { name: "Churn", value: -15 },
 *   ],
 *   { total: "Q2" },
 * );
 * // bars at 0→100, 100→140, 140→125, and a closing anchor 0→125
 * ```
 */
export function buildWaterfall(
  steps: readonly WaterfallStepInput[],
  { total }: WaterfallOptions = {},
): WaterfallResult {
  const built: WaterfallStep[] = [];
  let running = 0;

  for (const step of steps) {
    if (!Number.isFinite(step.value)) continue;
    const kind = step.kind ?? "delta";

    if (kind === "total") {
      running = step.value;
      built.push({
        color: step.color,
        cumulative: running,
        delta: 0,
        direction: "total",
        from: 0,
        key: String(built.length),
        kind,
        name: step.name,
        to: running,
      });
      continue;
    }

    const from = running;
    running += step.value;
    built.push({
      color: step.color,
      cumulative: running,
      delta: step.value,
      direction: step.value > 0 ? "up" : step.value < 0 ? "down" : "flat",
      from,
      key: String(built.length),
      kind,
      name: step.name,
      to: running,
    });
  }

  if (total !== undefined && built.length > 0)
    built.push({
      cumulative: running,
      delta: 0,
      direction: "total",
      from: 0,
      key: String(built.length),
      kind: "total",
      name: total,
      to: running,
    });

  if (built.length === 0)
    return {
      domain: [
        0,
        1,
      ],
      steps: [],
    };

  const bounds = built.flatMap((step) => [
    step.from,
    step.to,
  ]);
  return {
    domain: [
      Math.min(0, ...bounds),
      Math.max(0, ...bounds),
    ],
    steps: built,
  };
}
