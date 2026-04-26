import type { GraphLink, GraphNode } from "./graph";

const CLUSTER_PALETTE = [
  "#1ed760",
  "#a855f7",
  "#f59e0b",
  "#ec4899",
  "#3b82f6",
  "#34d399",
  "#fb923c",
  "#22d3ee",
  "#f472b6",
  "#84cc16",
  "#c084fc",
  "#fbbf24",
  "#06b6d4",
  "#f43f5e",
  "#a3e635",
  "#1ec6d4",
];

// Label-propagation community detection: each node starts in its own
// community; on each pass we have every node adopt the most common label
// among its neighbors (weighted by edge jaccard). Converges in 5–15 passes
// on graphs of this size, no deps. Equivalent quality to Louvain for dense
// genre-overlap graphs.
//
// Returns a map nodeId → clusterId. Cluster IDs are arbitrary integers.
export function detectClusters(
  nodes: GraphNode[],
  links: GraphLink[],
): Map<string, number> {
  const labels = new Map<string, number>();
  nodes.forEach((n, i) => labels.set(n.id, i));

  const neighbors = new Map<string, { id: string; weight: number }[]>();
  for (const n of nodes) neighbors.set(n.id, []);
  for (const l of links) {
    const s = typeof l.source === "string" ? l.source : (l.source as { id: string }).id;
    const t = typeof l.target === "string" ? l.target : (l.target as { id: string }).id;
    const w = l.jaccard || 0.1;
    neighbors.get(s)?.push({ id: t, weight: w });
    neighbors.get(t)?.push({ id: s, weight: w });
  }

  const order = nodes.map((n) => n.id);
  const MAX_PASSES = 20;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // Shuffle to avoid pathological propagation order.
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let changes = 0;
    for (const id of order) {
      const nbrs = neighbors.get(id);
      if (!nbrs || nbrs.length === 0) continue;
      const tally = new Map<number, number>();
      for (const { id: nid, weight } of nbrs) {
        const lbl = labels.get(nid);
        if (lbl === undefined) continue;
        tally.set(lbl, (tally.get(lbl) ?? 0) + weight);
      }
      let bestLabel = labels.get(id)!;
      let bestWeight = -1;
      for (const [lbl, w] of tally) {
        if (w > bestWeight) {
          bestWeight = w;
          bestLabel = lbl;
        }
      }
      if (bestLabel !== labels.get(id)) {
        labels.set(id, bestLabel);
        changes++;
      }
    }
    if (changes === 0) break;
  }

  // Compact labels → 0..k-1, ordered by cluster size (largest = id 0) so
  // palette assignment is stable across renders.
  const sizeByLabel = new Map<number, number>();
  for (const lbl of labels.values()) {
    sizeByLabel.set(lbl, (sizeByLabel.get(lbl) ?? 0) + 1);
  }
  const sortedLabels = Array.from(sizeByLabel.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([lbl]) => lbl);
  const remap = new Map<number, number>();
  sortedLabels.forEach((lbl, i) => remap.set(lbl, i));

  const out = new Map<string, number>();
  for (const [id, lbl] of labels) out.set(id, remap.get(lbl) ?? 0);
  return out;
}

export function clusterColor(clusterId: number): string {
  return CLUSTER_PALETTE[clusterId % CLUSTER_PALETTE.length];
}

// Tally most common tags across a node set; used to populate the tag-chip
// filter UI with the user's actually-present tags (vs hardcoded list).
export function topTagsFromNodes(
  nodes: GraphNode[],
  limit = 24,
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    for (const g of n.genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}
