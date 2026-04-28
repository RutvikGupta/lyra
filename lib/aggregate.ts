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

// Spotify's "reason_start" values that imply the user actively chose
// this track (rather than it auto-playing from queue/radio/etc):
//   - clickrow: tapped a row in a list
//   - playbtn:  hit play
// fwdbtn / backbtn are intentionally excluded — they're more often
// "skipping past something" than "picking this".
const ACTIVE_START_REASONS = new Set(["clickrow", "playbtn"]);

function isActiveStart(reasonStart?: string): boolean {
  return !!reasonStart && ACTIVE_START_REASONS.has(reasonStart);
}

// Some datasets don't carry the play-level metadata that the
// sessionEntry / skipBucket filters depend on. Specifically:
//   - Spotify "Account Data (12 months)" omits reason_start AND skipped.
//   - Apple Music exports omit both entirely.
//   - Spotify "Extended Streaming History" includes both.
//
// Detect feature availability once over the input array so we can
// skip filters that would otherwise quietly empty the graph (or pass
// everything through for the wrong reason). Threshold of >5% present
// to count it as "available" — handles mixed-source uploads where one
// source carries the field and the other doesn't.
function datasetCapabilities(plays: Play[]): {
  hasReasonStart: boolean;
  hasSkipFlag: boolean;
} {
  if (plays.length === 0) return { hasReasonStart: false, hasSkipFlag: false };
  const sample = plays.length > 1000 ? plays.slice(0, 1000) : plays;
  let reasonCount = 0;
  let skipCount = 0;
  for (const p of sample) {
    if (p.reasonStart) reasonCount++;
    if (p.skipped !== undefined) skipCount++;
  }
  const threshold = sample.length * 0.05;
  return {
    hasReasonStart: reasonCount > threshold,
    hasSkipFlag: skipCount > threshold,
  };
}

function applyPlayFilters(plays: Play[], f: PlayFilters | undefined): Play[] {
  if (!f) return plays;
  const todSet =
    f.timeOfDay && f.timeOfDay.length > 0 && f.timeOfDay.length < 4
      ? new Set(f.timeOfDay)
      : null;
  // Cheap pre-pass so the per-play loop doesn't re-check capabilities.
  const sessionEntryActive = !!f.sessionEntry && f.sessionEntry !== "all";
  const caps = sessionEntryActive
    ? datasetCapabilities(plays)
    : { hasReasonStart: true, hasSkipFlag: true };
  // If the dataset has no reason_start data, the sessionEntry filter
  // has no signal — degrade to a no-op so the user sees their library
  // instead of an empty graph. UI tooltip in CriteriaBar.tsx warns
  // when this happens.
  const skipSessionFilter = sessionEntryActive && !caps.hasReasonStart;
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
    if (sessionEntryActive && !skipSessionFilter) {
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

  // skipCount only carries signal when at least one play in the
  // dataset reported `skipped`. Apple Music exports + Spotify Account
  // Data (12mo) don't have it; in those cases skipCount is 0 for
  // every track, which would make "skipRate < 0.15" pass trivially
  // and "low / ≤5% skips" pass everything. Detect the dataset's
  // capability once and drop skip-related filtering when missing.
  const skipDataPresent = result.some((t) => t.skipCount > 0);

  if (options.lovedOnly) {
    result = result.filter((t) => {
      // Spotify's data export has NO "saved" or "liked" flag, so
      // "Loved" is necessarily a heuristic from play behavior. Tight
      // rule that resists single-play-completion false positives:
      //   1. Played at least 5 times (you came back to it).
      //   2. avg play length ≥ 70% of the longest play.
      //   3. Skip rate < 15% — only enforced if the dataset carries
      //      skip data; for Apple Music etc. we drop this clause so
      //      the heuristic still works on what's there.
      const avg = t.msPlayed / t.playCount;
      const ratio = t.maxMsPlayed > 0 ? avg / t.maxMsPlayed : 0;
      if (t.playCount < 5) return false;
      if (ratio < 0.7) return false;
      if (skipDataPresent) {
        const skipRate = t.skipCount / t.playCount;
        if (skipRate >= 0.15) return false;
      }
      return true;
    });
  }
  if (options.skipBucket && options.skipBucket !== "any") {
    if (!skipDataPresent) {
      // No-op rather than passing everything through and looking
      // like the user's listening history is somehow skip-free.
    } else {
      const max = options.skipBucket === "low" ? 0.2 : 0.05;
      result = result.filter((t) => t.skipCount / t.playCount <= max);
    }
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
