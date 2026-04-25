import type { Artist, Play } from "./types";

export type AggregatedArtist = {
  name: string;
  playCount: number;
  msPlayed: number;
  trackCount: number;
};

export function aggregateTopArtists(
  artists: Artist[],
  n: number,
): AggregatedArtist[] {
  return [...artists]
    .sort((a, b) => b.totalMsPlayed - a.totalMsPlayed)
    .slice(0, n)
    .map((a) => ({
      name: a.name,
      playCount: a.playCount,
      msPlayed: a.totalMsPlayed,
      trackCount: a.trackCount,
    }));
}

// Library aggregation with year filter and configurable sort.
// Pass `year: "all"` for full lifetime aggregation.
export function aggregateTopArtistsFromPlays(
  plays: Play[],
  options: {
    year: number | "all";
    sortBy?: "msPlayed" | "playCount";
    limit: number;
  },
): AggregatedArtist[] {
  const filtered =
    options.year === "all"
      ? plays
      : plays.filter((p) => {
          const d = new Date(p.ts);
          return d.getUTCFullYear() === options.year;
        });

  type Acc = {
    name: string;
    playCount: number;
    msPlayed: number;
    trackKeys: Set<string>;
  };
  const map = new Map<string, Acc>();
  for (const p of filtered) {
    const key = p.artistName.toLowerCase();
    let entry = map.get(key);
    if (!entry) {
      entry = {
        name: p.artistName,
        playCount: 0,
        msPlayed: 0,
        trackKeys: new Set(),
      };
      map.set(key, entry);
    }
    entry.playCount++;
    entry.msPlayed += p.msPlayed;
    entry.trackKeys.add(p.trackUri ?? `${p.trackName}::${p.artistName}`);
  }

  const sortBy = options.sortBy ?? "msPlayed";
  return Array.from(map.values())
    .map((e) => ({
      name: e.name,
      playCount: e.playCount,
      msPlayed: e.msPlayed,
      trackCount: e.trackKeys.size,
    }))
    .sort((a, b) =>
      sortBy === "playCount"
        ? b.playCount - a.playCount
        : b.msPlayed - a.msPlayed,
    )
    .slice(0, options.limit);
}

// Compute which years have any plays — used to populate the year picker.
export function yearsWithPlays(plays: Play[]): number[] {
  const set = new Set<number>();
  for (const p of plays) {
    const d = new Date(p.ts);
    set.add(d.getUTCFullYear());
  }
  return Array.from(set).sort((a, b) => b - a);
}
