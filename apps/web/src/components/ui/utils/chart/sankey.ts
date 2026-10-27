/**
 * Turns the node/link shape `Chart.Sankey` exposes — nodes addressed by a readable `id`, links naming that id —
 * into the index-based structure recharts' `Sankey` requires, dropping the links that would break its layout
 * on the way. Free of React and recharts so the resolution can be unit-tested on its own.
 */

export interface SankeyNodeInput {
  /** Unique identifier, referenced by a link's `source`/`target`. */
  id: string;
  /** Label drawn beside the node; falls back to `id`. */
  name?: string;
  /** Color of the node and of the flows leaving it; falls back to the palette rotation. */
  color?: string;
}

export interface SankeyLinkInput {
  /** `id` of the node the flow leaves. */
  source: string;
  /** `id` of the node the flow enters. */
  target: string;
  /** Size of the flow; must be above zero to be drawn. */
  value: number;
  /** Color of this flow; falls back to the source node's color. */
  color?: string;
}

export interface ResolvedSankeyNode {
  /** The input `id`, kept so a tooltip or test can address the node. */
  id: string;
  /** Label recharts reads through `nameKey`. */
  name: string;
  /** Resolved color, never undefined. */
  color: string;
}

export interface ResolvedSankeyLink {
  /** Index into `nodes`. */
  source: number;
  /** Index into `nodes`. */
  target: number;
  value: number;
  /** Resolved color, never undefined. */
  color: string;
}

/** Why a link was left out, for the counts in {@link ResolvedSankeyData.dropped}. */
export interface SankeyDropCounts {
  /** Named a `source` or `target` that no node declares. */
  unknownNode: number;
  /** Same node on both ends — recharts has nowhere to route it. */
  selfLink: number;
  /** Zero, negative, or non-finite `value`. */
  emptyValue: number;
  /** Would close a loop; a Sankey layout only converges on a directed *acyclic* graph. */
  cycle: number;
}

export interface ResolvedSankeyData {
  nodes: ResolvedSankeyNode[];
  links: ResolvedSankeyLink[];
  /** How many links were left out, by reason. A caller can surface this; the chart ignores it and draws what's left. */
  dropped: SankeyDropCounts;
}

/**
 * Resolves nodes and links into recharts' index-based `SankeyData`.
 *
 * Nodes are de-duplicated by `id` (the first wins) and colored from `palette` in declaration order unless they
 * carry their own `color`. Links are kept in input order and validated: one naming an unknown node, pointing a
 * node at itself, carrying a non-positive value, or closing a cycle is dropped rather than left to produce a
 * `NaN` layout — a Sankey diagram is only defined on a directed acyclic graph. Each dropped link is counted in
 * `dropped` so the reason is inspectable instead of silent.
 *
 * @example
 * ```ts
 * toSankeyData(
 *   [{ id: "visit" }, { id: "signup" }],
 *   [{ source: "visit", target: "signup", value: 120 }],
 *   ["var(--chart-1)", "var(--chart-2)"],
 * );
 * ```
 */
export function toSankeyData(
  nodes: readonly SankeyNodeInput[],
  links: readonly SankeyLinkInput[],
  palette: readonly string[],
): ResolvedSankeyData {
  const indexById = new Map<string, number>();
  const resolvedNodes: ResolvedSankeyNode[] = [];
  for (const node of nodes) {
    if (indexById.has(node.id)) continue;
    indexById.set(node.id, resolvedNodes.length);
    resolvedNodes.push({
      color:
        node.color ??
        (palette.length > 0
          ? (palette[resolvedNodes.length % palette.length] as string)
          : "currentColor"),
      id: node.id,
      name: node.name ?? node.id,
    });
  }

  const dropped: SankeyDropCounts = {
    cycle: 0,
    emptyValue: 0,
    selfLink: 0,
    unknownNode: 0,
  };
  // Edges accepted so far, as adjacency, so a candidate can be tested for a
  // path back to its own source before it's added.
  const reachable = new Map<number, Set<number>>();
  const resolvedLinks: ResolvedSankeyLink[] = [];

  for (const link of links) {
    const source = indexById.get(link.source);
    const target = indexById.get(link.target);
    if (source === undefined || target === undefined) {
      dropped.unknownNode += 1;
      continue;
    }
    if (source === target) {
      dropped.selfLink += 1;
      continue;
    }
    if (!Number.isFinite(link.value) || link.value <= 0) {
      dropped.emptyValue += 1;
      continue;
    }
    if (hasPath(reachable, target, source)) {
      dropped.cycle += 1;
      continue;
    }

    const targets = reachable.get(source) ?? new Set<number>();
    targets.add(target);
    reachable.set(source, targets);
    resolvedLinks.push({
      color: link.color ?? (resolvedNodes[source] as ResolvedSankeyNode).color,
      source,
      target,
      value: link.value,
    });
  }

  return {
    dropped,
    links: resolvedLinks,
    nodes: resolvedNodes,
  };
}

/** Depth-first search for a path from `from` to `to` over the edges accepted so far. */
function hasPath(
  edges: Map<number, Set<number>>,
  from: number,
  to: number,
): boolean {
  if (from === to) return true;
  const seen = new Set<number>([
    from,
  ]);
  const stack = [
    from,
  ];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    for (const next of edges.get(current) ?? []) {
      if (next === to) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(next);
    }
  }
  return false;
}
