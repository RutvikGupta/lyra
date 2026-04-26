import type { Artist, Play } from "./types";

export type AggregatedArtist = {
  name: string;
  playCount: number;
  msPlayed: number;
  trackCount: number;
};

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";
export type DayOfWeek = "all" | "weekday" | "weekend";
export type SkipBucket = "any" | "low" | "none";
export type SessionEntry = "all" | "active" | "auto";

export type PlayFilters = {
  timeOfDay?: TimeOfDay[]; // empty or full = no filter
  dayOfWeek?: DayOfWeek;
  sessionEntry?: SessionEntry;
};

export type TrackFilters = {
  lovedOnly?: boolean;
  skipBucket?: SkipBucket;
  discoveryYear?: number | "all";
};

function timeOfDayBucket(hour: number): TimeOfDay {
  if (hour < 5) return "night";
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

function isActiveStart(reasonStart?: string): boolean {
  return reasonStart === "clickrow" || reasonStart === "playbtn";
}

function applyPlayFilters(plays: Play[], f: PlayFilters | undefined): Play[] {
  if (!f) return plays;
  const todSet =
    f.timeOfDay && f.timeOfDay.length > 0 && f.timeOfDay.length < 4
      ? new Set(f.timeOfDay)
      : null;
  return plays.filter((p) => {
    const d = new Date(p.ts);
    if (todSet) {
      if (!todSet.has(timeOfDayBucket(d.getHours()))) return false;
    }
    if (f.dayOfWeek && f.dayOfWeek !== "all") {
      const day = d.getDay();
      const weekend = day === 0 || day === 6;
      if (f.dayOfWeek === "weekend" && !weekend) return false;
      if (f.dayOfWeek === "weekday" && weekend) return false;
    }
    if (f.sessionEntry && f.sessionEntry !== "all") {
      const active = isActiveStart(p.reasonStart);
      if (f.sessionEntry === "active" && !active) return false;
      if (f.sessionEntry === "auto" && active) return false;
    }
    return true;
  });
}

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
  } & PlayFilters,
): AggregatedArtist[] {
  let filtered =
    options.year === "all"
      ? plays
      : plays.filter((p) => {
          const d = new Date(p.ts);
          return d.getUTCFullYear() === options.year;
        });
  filtered = applyPlayFilters(filtered, options);

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

export type AggregatedTrack = {
  uri?: string;
  name: string;
  artistName: string;
  albumName?: string;
  playCount: number;
  msPlayed: number;
  // ms epoch of the earliest play of this track. Carried through to the
  // showcase snapshot so the Discovered-year filter can populate without
  // raw plays.
  firstPlayed?: number;
};

export function aggregateTopTracksFromPlays(
  plays: Play[],
  options: {
    year: number | "all";
    sortBy?: "msPlayed" | "playCount";
    limit: number;
  } & PlayFilters &
    TrackFilters,
): AggregatedTrack[] {
  let filtered =
    options.year === "all"
      ? plays
      : plays.filter((p) => {
          const d = new Date(p.ts);
          return d.getUTCFullYear() === options.year;
        });
  filtered = applyPlayFilters(filtered, options);

  type Acc = AggregatedTrack & {
    maxMsPlayed: number;
    skipCount: number;
    firstPlayed: number;
  };
  const map = new Map<string, Acc>();
  for (const p of filtered) {
    const key =
      p.trackUri ??
      `${p.trackName.toLowerCase()}::${p.artistName.toLowerCase()}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        uri: p.trackUri,
        name: p.trackName,
        artistName: p.artistName,
        albumName: p.albumName,
        playCount: 0,
        msPlayed: 0,
        maxMsPlayed: 0,
        skipCount: 0,
        firstPlayed: p.ts,
      };
      map.set(key, entry);
    }
    entry.playCount++;
    entry.msPlayed += p.msPlayed;
    if (p.msPlayed > entry.maxMsPlayed) entry.maxMsPlayed = p.msPlayed;
    if (p.skipped) entry.skipCount++;
    if (p.ts < entry.firstPlayed) entry.firstPlayed = p.ts;
  }

  let result = Array.from(map.values());

  if (options.lovedOnly) {
    result = result.filter((t) => {
      // "Loved": avg play length is at least half the longest play (proxy
      // for duration), AND skip rate < 30%.
      const avg = t.msPlayed / t.playCount;
      const ratio = t.maxMsPlayed > 0 ? avg / t.maxMsPlayed : 0;
      const skipRate = t.skipCount / t.playCount;
      return ratio >= 0.5 && skipRate < 0.3;
    });
  }
  if (options.skipBucket && options.skipBucket !== "any") {
    const max = options.skipBucket === "low" ? 0.2 : 0.05;
    result = result.filter((t) => t.skipCount / t.playCount <= max);
  }
  if (options.discoveryYear !== undefined && options.discoveryYear !== "all") {
    const target = options.discoveryYear;
    result = result.filter(
      (t) => new Date(t.firstPlayed).getUTCFullYear() === target,
    );
  }

  const sortBy = options.sortBy ?? "msPlayed";
  return result
    .sort((a, b) =>
      sortBy === "playCount"
        ? b.playCount - a.playCount
        : b.msPlayed - a.msPlayed,
    )
    .slice(0, options.limit)
    .map((t) => ({
      uri: t.uri,
      name: t.name,
      artistName: t.artistName,
      albumName: t.albumName,
      playCount: t.playCount,
      msPlayed: t.msPlayed,
      firstPlayed: t.firstPlayed,
    }));
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
