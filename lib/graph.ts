export type ArtistInput = {
  id: string;
  rank: number;
  name: string;
  genres: string[];
  image?: string | null;
  popularity: number;
  listeners?: number;
  playcount?: number;
  // Library mode: user's personal play count for this artist.
  myPlayCount?: number;
  // Library mode: total ms the user has spent listening to this artist.
  // Used for sortBy="msPlayed" sizing — falls back to myPlayCount.
  myMsPlayed?: number;
};

export type GraphNode = {
  id: string;
  name: string;
  genres: string[];
  image?: string | null;
  popularity: number;
  listeners: number;
  playcount: number;
  rank: number;
  primaryGenre: string;
  color: string;
  size: number;
  // Track-only — present when this node is a track instead of an artist.
  // The renderer/details panel branch on the presence of artistName.
  artistName?: string;
  albumName?: string;
  myPlayCount?: number;
  myMsPlayed?: number;
  trackUri?: string;
};

export type GraphLink = {
  source: string;
  target: string;
  shared: number;
  sharedGenres: string[];
  // Jaccard similarity = |shared| / |union of genres|. Used for edge
  // ranking + top-K filtering. Range 0..1.
  jaccard: number;
};

// Edge selection knobs — tune these to make the graph more or less dense.
const MIN_JACCARD = 0.22;
const MAX_LINKS_PER_NODE = 8;

// Anchors orphan nodes (no edges passing the Jaccard threshold) to their
// single best-overlap neighbor regardless of similarity strength. Prevents
// strong charge repulsion from flinging isolated nodes off into space.
function addOrphanAnchors(
  nodes: { id: string }[],
  links: GraphLink[],
  bestNeighborByNode: Map<string, GraphLink>,
): GraphLink[] {
  const linked = new Set<string>();
  for (const l of links) {
    linked.add(l.source);
    linked.add(l.target);
  }
  const seen = new Set<GraphLink>(links);
  const result = [...links];
  for (const node of nodes) {
    if (linked.has(node.id)) continue;
    const best = bestNeighborByNode.get(node.id);
    if (best && !seen.has(best)) {
      result.push(best);
      seen.add(best);
    }
  }
  return result;
}

function computeOverlap(
  aGenres: Set<string>,
  bGenres: string[],
): { shared: string[]; jaccard: number } {
  const sharedSet = new Set<string>();
  const unionSet = new Set<string>(aGenres);
  for (const g of bGenres) {
    unionSet.add(g);
    if (aGenres.has(g)) sharedSet.add(g);
  }
  const shared = Array.from(sharedSet);
  const jaccard = unionSet.size === 0 ? 0 : shared.length / unionSet.size;
  return { shared, jaccard };
}

// Keep an edge if at least one endpoint has it in their top-K strongest
// connections. Produces a sparse, navigable graph where each node has
// roughly ≤K but no node gets stranded entirely.
function topKPerNode(
  links: GraphLink[],
  k: number,
): GraphLink[] {
  const byNode = new Map<string, GraphLink[]>();
  for (const link of links) {
    const a = byNode.get(link.source) ?? [];
    a.push(link);
    byNode.set(link.source, a);
    const b = byNode.get(link.target) ?? [];
    b.push(link);
    byNode.set(link.target, b);
  }
  const kept = new Set<GraphLink>();
  for (const arr of byNode.values()) {
    arr.sort((a, b) => b.jaccard - a.jaccard);
    for (let i = 0; i < Math.min(k, arr.length); i++) {
      kept.add(arr[i]);
    }
  }
  return Array.from(kept);
}

const PALETTE = [
  "#1ed760",
  "#1ec6d4",
  "#a855f7",
  "#f43f5e",
  "#f59e0b",
  "#3b82f6",
  "#84cc16",
  "#ec4899",
  "#06b6d4",
  "#fb923c",
  "#a3e635",
  "#c084fc",
  "#22d3ee",
  "#fbbf24",
  "#f472b6",
  "#34d399",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function genreColor(genre: string): string {
  return PALETTE[hash(genre) % PALETTE.length];
}

export type TrackInput = {
  uri?: string;
  rank: number;
  name: string;
  artistName: string;
  albumName?: string;
  playCount: number;
  msPlayed: number;
};

export function buildTrackGraph(
  tracks: TrackInput[],
  artistGenresByLowerName: Map<string, string[]>,
  sortBy: "msPlayed" | "playCount" = "playCount",
): { nodes: GraphNode[]; links: GraphLink[] } {
  // Size by whichever metric the user is currently sorting by, so the
  // visual matches the ranking. sqrt-scaled so the top item doesn't
  // dwarf the rest.
  const metric = (t: TrackInput) =>
    sortBy === "msPlayed" ? (t.msPlayed ?? 0) : (t.playCount ?? 0);
  const maxMetric = tracks.reduce((m, t) => Math.max(m, metric(t)), 0);
  const nodes: GraphNode[] = tracks.map((t) => {
    const genres =
      artistGenresByLowerName.get(t.artistName.toLowerCase()) ?? [];
    const primaryGenre = genres[0] ?? "unknown";
    // ForceGraph3D renders radius = nodeRelSize × cbrt(nodeVal), so a
    // 4× value range (8→32) only becomes a 1.6× visual radius range.
    // Widen aggressively (range 4→144) so cbrt yields ~3.3× visual
    // ratio between the smallest and largest nodes — top tracks
    // visibly tower over the long tail. sqrt keeps the long tail
    // distinguishable rather than all collapsing onto the floor.
    const size =
      maxMetric > 0
        ? 4 + Math.sqrt(metric(t) / maxMetric) * 140
        : 4;
    return {
      id:
        t.uri ??
        `track:${t.name.toLowerCase()}::${t.artistName.toLowerCase()}`,
      name: t.name,
      genres,
      image: null,
      popularity: 0,
      listeners: 0,
      playcount: 0,
      rank: t.rank,
      primaryGenre,
      color: genreColor(primaryGenre),
      size,
      artistName: t.artistName,
      albumName: t.albumName,
      myPlayCount: t.playCount,
      myMsPlayed: t.msPlayed,
      trackUri: t.uri,
    };
  });

  const candidates: GraphLink[] = [];
  const bestNeighborByNode = new Map<string, GraphLink>();
  for (let i = 0; i < nodes.length; i++) {
    const aGenres = new Set(nodes[i].genres);
    if (aGenres.size === 0) continue;
    const aArtist = nodes[i].artistName?.toLowerCase();
    for (let j = i + 1; j < nodes.length; j++) {
      if (aArtist && aArtist === nodes[j].artistName?.toLowerCase()) {
        continue;
      }
      const { shared, jaccard } = computeOverlap(aGenres, nodes[j].genres);
      if (shared.length === 0) continue;
      const link: GraphLink = {
        source: nodes[i].id,
        target: nodes[j].id,
        shared: shared.length,
        sharedGenres: shared,
        jaccard,
      };
      // Track each node's strongest possible neighbor (regardless of
      // threshold) so orphans can be anchored later.
      for (const id of [nodes[i].id, nodes[j].id]) {
        const cur = bestNeighborByNode.get(id);
        if (!cur || cur.jaccard < link.jaccard) {
          bestNeighborByNode.set(id, link);
        }
      }
      if (jaccard >= MIN_JACCARD && shared.length >= 2) {
        candidates.push(link);
      }
    }
  }
  const filtered = topKPerNode(candidates, MAX_LINKS_PER_NODE);
  const links = addOrphanAnchors(nodes, filtered, bestNeighborByNode);

  return { nodes, links };
}

export function buildArtistGraph(
  artists: ArtistInput[],
  sortBy: "msPlayed" | "playCount" = "playCount",
): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const safe = artists.map((a) => ({
    ...a,
    genres: Array.isArray(a.genres) ? a.genres.filter(Boolean) : [],
    popularity: typeof a.popularity === "number" ? a.popularity : 0,
  }));

  // Size by the active sort metric in library mode (so the biggest node
  // is always the top of the current ranking). API mode lacks per-user
  // plays — fall back to rank-based sizing there.
  const metric = (a: ArtistInput) =>
    sortBy === "msPlayed" ? (a.myMsPlayed ?? 0) : (a.myPlayCount ?? 0);
  const maxMetric = safe.reduce((m, a) => Math.max(m, metric(a)), 0);
  const nodes: GraphNode[] = safe.map((a) => {
    const primaryGenre = a.genres[0] ?? "unknown";
    // See buildTrackGraph for why the range is so wide — cbrt in the
    // renderer flattens nodeVal aggressively, so a small nominal range
    // produces near-uniform visual radii.
    let size: number;
    if (maxMetric > 0 && metric(a) > 0) {
      size = 4 + Math.sqrt(metric(a) / maxMetric) * 140;
    } else {
      const cappedRank = Math.min(Math.max(a.rank, 1), 50);
      size = 4 + ((50 - cappedRank) / 49) * 140;
    }
    return {
      id: a.id,
      name: a.name,
      genres: a.genres,
      image: a.image,
      popularity: a.popularity,
      listeners: a.listeners ?? 0,
      playcount: a.playcount ?? 0,
      rank: a.rank,
      primaryGenre,
      color: genreColor(primaryGenre),
      size,
    };
  });

  const candidates: GraphLink[] = [];
  const bestNeighborByNode = new Map<string, GraphLink>();
  for (let i = 0; i < safe.length; i++) {
    const aGenres = new Set(safe[i].genres);
    if (aGenres.size === 0) continue;
    for (let j = i + 1; j < safe.length; j++) {
      const { shared, jaccard } = computeOverlap(aGenres, safe[j].genres);
      if (shared.length === 0) continue;
      const link: GraphLink = {
        source: safe[i].id,
        target: safe[j].id,
        shared: shared.length,
        sharedGenres: shared,
        jaccard,
      };
      for (const id of [safe[i].id, safe[j].id]) {
        const cur = bestNeighborByNode.get(id);
        if (!cur || cur.jaccard < link.jaccard) {
          bestNeighborByNode.set(id, link);
        }
      }
      if (jaccard >= MIN_JACCARD && shared.length >= 2) {
        candidates.push(link);
      }
    }
  }
  const filtered = topKPerNode(candidates, MAX_LINKS_PER_NODE);
  const links = addOrphanAnchors(nodes, filtered, bestNeighborByNode);

  return { nodes, links };
}
