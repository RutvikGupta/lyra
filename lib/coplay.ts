import type { Play } from "./types";

// Two plays are "in the same session" if they happen within this gap.
// 30 minutes is the conventional Spotify session boundary — anything
// longer typically reflects a context shift (commute → work, etc).
const SESSION_GAP_MS = 30 * 60 * 1000;

export type CoplayMatrix = Map<string, Map<string, number>>;

function trackKey(p: Play): string {
  return p.trackUri ?? `track:${p.trackName.toLowerCase()}::${p.artistName.toLowerCase()}`;
}

// Build a co-play matrix: for every pair of tracks that occur in the same
// listening session (no gap > 30min between them), increment their pair
// count. Output is keyed by the same track IDs we use in the graph
// (`spotify:track:...` URI when available, else `track:name::artist`).
export function computeCoplayMatrix(plays: Play[]): CoplayMatrix {
  const matrix: CoplayMatrix = new Map();
  if (plays.length === 0) return matrix;

  const sorted = [...plays].sort((a, b) => a.ts - b.ts);

  // Walk plays in order; whenever a gap > SESSION_GAP_MS appears, flush
  // the current session into pairwise counts.
  let session: string[] = [];
  let lastTs = sorted[0].ts;

  const flush = () => {
    if (session.length < 2) {
      session = [];
      return;
    }
    const unique = Array.from(new Set(session));
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        bump(matrix, unique[i], unique[j]);
        bump(matrix, unique[j], unique[i]);
      }
    }
    session = [];
  };

  for (const p of sorted) {
    if (p.ts - lastTs > SESSION_GAP_MS) flush();
    session.push(trackKey(p));
    lastTs = p.ts;
  }
  flush();

  return matrix;
}

function bump(matrix: CoplayMatrix, a: string, b: string) {
  let row = matrix.get(a);
  if (!row) {
    row = new Map();
    matrix.set(a, row);
  }
  row.set(b, (row.get(b) ?? 0) + 1);
}

// Returns the IDs of the top-N tracks most often co-played with `id`,
// sorted by co-play count descending.
export function topCoplayed(
  matrix: CoplayMatrix,
  id: string,
  limit = 12,
): { id: string; count: number }[] {
  const row = matrix.get(id);
  if (!row) return [];
  return Array.from(row.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }));
}
