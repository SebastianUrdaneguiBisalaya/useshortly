/**
 * Row preparation for `Chart.Dumbbell`: two measurements per category in, the delta and the drawing order out.
 * Ordering is the substance here — a dumbbell chart is read by scanning the column of connectors, which only
 * tells a story when the rows are sorted by the change rather than by however the data arrived. Free of React
 * and recharts so it can be unit-tested on its own.
 */

export interface DumbbellRowInput {
	/** Category label, e.g. a team, region or feature. */
	name: string;
	/** First measurement — the "before" dot. */
	start: number;
	/** Second measurement — the "after" dot. */
	end: number;
}

/** Which key the rows are ordered by. `"none"` keeps the caller's order. */
export type DumbbellSort = 'delta' | 'end' | 'name' | 'none' | 'start';

/** Whether the value rose, fell, or didn't move between the two measurements. */
export type DumbbellDirection = 'down' | 'flat' | 'up';

export interface DumbbellRow extends DumbbellRowInput {
	/** `end - start`; negative when the value fell. */
	delta: number;
	direction: DumbbellDirection;
}

export interface DumbbellOptions {
	/**
	 * Key the rows are ordered by.
	 * @default "none"
	 */
	sort?: DumbbellSort;
	/**
	 * Direction of that order. For `"name"`, `"asc"` is A→Z.
	 * @default "desc"
	 */
	order?: 'asc' | 'desc';
	/**
	 * Stretches the value domain down to zero. Off by default: a dumbbell is read by the *gap* between the two
	 * dots, and anchoring a 60→90 range at zero squeezes every gap into the top third of the plot.
	 * @default false
	 */
	includeZero?: boolean;
}

export interface DumbbellResult {
	rows: DumbbellRow[];
	/** `[min, max]` across both measurements of every row, for the value axis. */
	domain: [number, number];
}

/**
 * Computes each row's delta and puts the rows in drawing order.
 *
 * A row whose `start` or `end` isn't finite has no pair to connect, so it's dropped. Sorting is stable, so rows
 * tied on the sort key keep the order they were given. An empty set yields no rows and a placeholder domain.
 *
 * @example
 * ```ts
 * buildDumbbell(
 *   [
 *     { end: 72, name: "Support", start: 64 },
 *     { end: 58, name: "Sales", start: 70 },
 *   ],
 *   { sort: "delta" },
 * );
 * // Support (+8) first, Sales (−12) last
 * ```
 */
export function buildDumbbell(rows: readonly DumbbellRowInput[], { sort = 'none', order = 'desc', includeZero = false }: DumbbellOptions = {}): DumbbellResult {
	const prepared: DumbbellRow[] = rows
		.filter(row => Number.isFinite(row.start) && Number.isFinite(row.end))
		.map(row => {
			const delta = row.end - row.start;
			return {
				delta,
				direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
				end: row.end,
				name: row.name,
				start: row.start,
			};
		});

	if (prepared.length === 0)
		return {
			domain: [0, 1],
			rows: [],
		};

	if (sort !== 'none') {
		const sign = order === 'asc' ? 1 : -1;
		// `Array.prototype.sort` is stable, so ties keep their input order.
		prepared.sort((a, b) => (sort === 'name' ? sign * a.name.localeCompare(b.name) : sign * (a[sort] - b[sort])));
	}

	const bounds = prepared.flatMap(row => [row.start, row.end]);
	return {
		domain: [includeZero ? Math.min(0, ...bounds) : Math.min(...bounds), includeZero ? Math.max(0, ...bounds) : Math.max(...bounds)],
		rows: prepared,
	};
}
