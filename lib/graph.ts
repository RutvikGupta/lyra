export type ArtistInput = {
  id: string;
  rank: number;
  name: string;
  genres: string[];
  image?: string | null;
  popularity: number;
  listeners?: number;
  playcount?: number;
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
};

export type GraphLink = {
  source: string;
  target: string;
  shared: number;
  sharedGenres: string[];
};

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

export function buildArtistGraph(artists: ArtistInput[]): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const safe = artists.map((a) => ({
    ...a,
    genres: Array.isArray(a.genres) ? a.genres.filter(Boolean) : [],
    popularity: typeof a.popularity === "number" ? a.popularity : 0,
  }));

  const nodes: GraphNode[] = safe.map((a) => {
    const primaryGenre = a.genres[0] ?? "unknown";
    // Spotify removed `popularity` from artist responses in Feb 2026, so size
    // by rank: rank 1 = largest (14), rank 50 = smallest (4). Linear taper.
    const cappedRank = Math.min(Math.max(a.rank, 1), 50);
    const size = 4 + ((50 - cappedRank) / 49) * 10;
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

  const links: GraphLink[] = [];
  // Require >=2 shared genres so weakly-related noise edges are dropped.
  // Clusters stay dense; cross-cluster bridges only appear when there's
  // genuine overlap (e.g. hip-hop ↔ pop ↔ rnb).
  const MIN_SHARED = 2;
  for (let i = 0; i < safe.length; i++) {
    const aGenres = new Set(safe[i].genres);
    if (aGenres.size === 0) continue;
    for (let j = i + 1; j < safe.length; j++) {
      const sharedGenres: string[] = [];
      for (const g of safe[j].genres) {
        if (aGenres.has(g)) sharedGenres.push(g);
      }
      if (sharedGenres.length >= MIN_SHARED) {
        links.push({
          source: safe[i].id,
          target: safe[j].id,
          shared: sharedGenres.length,
          sharedGenres,
        });
      }
    }
  }

  return { nodes, links };
}
