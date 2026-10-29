/**
 * Binning for `Chart.Histogram`: raw observations in, bin ranges with counts out. Deliberately free of React
 * and recharts so the algorithm can be reasoned about (and unit-tested) on its own — the chart only turns the
 * bins this returns into rectangles.
 */

/** Rule used to pick a bin count when the caller doesn't give one. */
export type HistogramRule = 'freedman-diaconis' | 'scott' | 'sturges';

export interface HistogramBin {
	/** Lower edge, inclusive. */
	from: number;
	/** Upper edge — exclusive, except on the last bin, which includes it so the largest observation is counted. */
	to: number;
	/** How many observations fell in this bin. */
	count: number;
	/** This bin's share of all binned observations, 0–1. */
	share: number;
}

export interface HistogramOptions {
	/**
	 * A target number of bins, or explicit edges (`[0, 10, 20, 50]` — 3 bins, the last one wider). Edges are
	 * sorted and de-duplicated; fewer than two usable ones falls back to automatic binning. Omit for a count
	 * derived from `rule`.
	 */
	bins?: number | readonly number[];
	/**
	 * Rule that derives the bin count from the data's spread when `bins` isn't a number or an array.
	 * @default "freedman-diaconis"
	 */
	rule?: HistogramRule;
	/**
	 * Rounds automatic edges to readable steps (1/2/5 × 10ⁿ) instead of splitting the exact range, which makes
	 * the axis labels legible at the cost of the bin count landing near the target rather than on it. Ignored
	 * when `bins` is an explicit array.
	 * @default true
	 */
	nice?: boolean;
}

/** Bin counts beyond this stop being a histogram and start being a denial-of-service, so both the rules and an explicit count are clamped to it. */
const MAX_BINS = 200;

/** Half-width given to the single bin produced when every observation is identical, so it still draws as a rectangle instead of a zero-width sliver. */
const SINGLE_VALUE_PAD = 0.5;

/** Trims the float noise that arithmetic on edges produces (`0.30000000000000004` → `0.3`). */
function round(value: number) {
	return Number(value.toFixed(10));
}

function clampCount(count: number) {
	if (!Number.isFinite(count)) return 1;
	return Math.min(MAX_BINS, Math.max(1, Math.floor(count)));
}

/**
 * Linearly interpolated quantile of an **ascending** array (the same definition as R's type 7 and NumPy's
 * default), so the interquartile range doesn't jump between observations on small samples.
 * @param sorted Ascending, finite values.
 * @param p Probability, clamped to 0–1.
 */
export function quantile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) return Number.NaN;
	const first = sorted[0] as number;
	if (sorted.length === 1) return first;
	const position = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	const weight = position - lower;
	return (sorted[lower] as number) * (1 - weight) + (sorted[upper] as number) * weight;
}

/** Population standard deviation, used by Scott's rule. */
function standardDeviation(values: readonly number[]) {
	const n = values.length;
	if (n < 2) return 0;
	const mean = values.reduce((sum, value) => sum + value, 0) / n;
	const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
	return Math.sqrt(variance);
}

/**
 * Bin count suggested for an **ascending** sample. Freedman–Diaconis (the default) scales with the
 * interquartile range, so a few extreme observations don't shred the rest of the distribution into slivers;
 * Scott's rule uses the standard deviation instead, and Sturges' only the sample size. Degenerate samples
 * (fewer than two observations, zero spread, or a rule that yields a non-positive width) fall back to
 * Sturges, then to a single bin.
 */
export function suggestBinCount(sorted: readonly number[], rule: HistogramRule = 'freedman-diaconis'): number {
	const n = sorted.length;
	if (n < 2) return 1;
	const range = (sorted[n - 1] as number) - (sorted[0] as number);
	if (range <= 0) return 1;

	const sturges = Math.ceil(Math.log2(n)) + 1;
	if (rule === 'sturges') return clampCount(sturges);

	const width = rule === 'scott' ? 3.49 * standardDeviation(sorted) * n ** (-1 / 3) : 2 * (quantile(sorted, 0.75) - quantile(sorted, 0.25)) * n ** (-1 / 3);

	if (!(width > 0)) return clampCount(sturges);
	return clampCount(Math.ceil(range / width));
}

/**
 * Edges covering `[lo, hi]` on readable steps (1/2/5 × 10ⁿ), aligned to multiples of the step so labels land
 * on round numbers. `targetCount` is a target, not a guarantee: rounding the step is what makes the axis
 * legible, and it moves the count.
 */
export function niceBinEdges(lo: number, hi: number, targetCount: number): number[] {
	const count = clampCount(targetCount);
	const rawStep = (hi - lo) / count;
	if (!(rawStep > 0)) return [round(lo - SINGLE_VALUE_PAD), round(lo + SINGLE_VALUE_PAD)];

	const power = 10 ** Math.floor(Math.log10(rawStep));
	const fraction = rawStep / power;
	const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
	const start = Math.floor(lo / step) * step;
	const end = Math.ceil(hi / step) * step;

	const edges: number[] = [];
	// Half a step of slack, so the last edge isn't lost to float noise.
	for (let edge = start; edge <= end + step / 2; edge += step) edges.push(round(edge));
	// A range that fits inside one step still needs two edges to be a bin.
	if (edges.length < 2) edges.push(round(start + step));
	return edges;
}

/** Edges splitting `[lo, hi]` into exactly `count` equal bins. */
function exactBinEdges(lo: number, hi: number, count: number): number[] {
	const step = (hi - lo) / count;
	return Array.from(
		{
			length: count + 1,
		},
		(_, index) => round(index === count ? hi : lo + index * step)
	);
}

/**
 * Groups observations into bins with their counts and shares.
 *
 * Non-finite values (`NaN`, `±Infinity`, and anything that isn't a number at runtime) are dropped rather than
 * poisoning the range, and an empty sample yields no bins. Every bin is half-open (`from` inclusive, `to`
 * exclusive) except the last, which includes its upper edge — otherwise the largest observation would fall
 * outside every bin. With explicit `bins` edges, observations outside the outermost pair are left out, so
 * `share` is a share of what was actually binned.
 *
 * @example
 * ```ts
 * binValues([1, 2, 2, 3, 9], { bins: [0, 5, 10] });
 * // [{ from: 0, to: 5, count: 4, share: 0.8 }, { from: 5, to: 10, count: 1, share: 0.2 }]
 * ```
 */
export function binValues(values: readonly number[], { bins, rule = 'freedman-diaconis', nice = true }: HistogramOptions = {}): HistogramBin[] {
	const sorted = values.filter(value => Number.isFinite(value)).sort((a, b) => a - b);
	if (sorted.length === 0) return [];

	const explicit = Array.isArray(bins) ? Array.from(new Set(bins.filter(edge => Number.isFinite(edge)))).sort((a, b) => a - b) : [];

	const edges = explicit.length >= 2 ? explicit : autoEdges(sorted, bins, rule, nice);
	if (edges.length < 2) return [];

	const counts = new Array<number>(edges.length - 1).fill(0);
	const lowest = edges[0] as number;
	const highest = edges[edges.length - 1] as number;
	let total = 0;
	// The sample is ascending, so the bin pointer only ever moves forward.
	let bin = 0;
	for (const value of sorted) {
		if (value < lowest) continue;
		if (value > highest) break;
		while (bin < counts.length - 1 && value >= (edges[bin + 1] as number)) bin += 1;
		counts[bin] = (counts[bin] as number) + 1;
		total += 1;
	}

	return counts.map((count, index) => ({
		count,
		from: edges[index] as number,
		share: total > 0 ? count / total : 0,
		to: edges[index + 1] as number,
	}));
}

/** Edges for a sample with no explicit ones: a single padded bin when the spread is zero, otherwise nice or exact edges for the resolved count. */
function autoEdges(sorted: readonly number[], bins: HistogramOptions['bins'], rule: HistogramRule, nice: boolean): number[] {
	const lo = sorted[0] as number;
	const hi = sorted[sorted.length - 1] as number;
	if (hi === lo) return [round(lo - SINGLE_VALUE_PAD), round(lo + SINGLE_VALUE_PAD)];

	const count = clampCount(typeof bins === 'number' ? Math.round(bins) : suggestBinCount(sorted, rule));
	return nice ? niceBinEdges(lo, hi, count) : exactBinEdges(lo, hi, count);
}
