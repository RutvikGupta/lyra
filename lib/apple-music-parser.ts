// Apple Music data export parser.
//
// Apple sends users a ZIP via privacy.apple.com containing several CSVs.
// The most useful for a per-play history graph is:
//
//   "Apple Music Play Activity.csv"
//
// One row per play event. Schema varies year-to-year (column names have
// drifted), so we identify columns by pattern-matching the header row
// rather than positional indexing. We also support:
//
//   "Apple Music - Recently Played Tracks.csv"  (last ~100 plays)
//   "Apple Music Play History Daily Tracks.csv" (daily aggregates;
//                                                synthesized to per-day plays)
//
// Apple's CSVs aren't pure RFC-4180 — quoted fields can contain commas,
// quoted-quotes appear as "", and rows can include CRLF or LF endings.
// The mini parser below handles all three.

import type { Play } from "./types";

// Apple's "Track Description" column is typically "Track Name by Artist
// Name". Some older exports have separate "Track Name" / "Artist Name"
// columns, which are preferred when available because they don't have
// the song-title-contains-" by " ambiguity.
const BY_DELIMITER = /\s+by\s+/;

export type AppleMusicFileKind =
  | "play-activity"
  | "recently-played"
  | "daily-tracks"
  | "unknown";

export function detectAppleMusicFile(filename: string): AppleMusicFileKind {
  const name = filename.split("/").pop()?.toLowerCase() ?? "";
  if (name.includes("play activity")) return "play-activity";
  if (name.includes("recently played")) return "recently-played";
  if (name.includes("play history daily")) return "daily-tracks";
  return "unknown";
}

// Returns true if any of the file paths look like Apple Music export
// files (CSVs in a ZIP or standalone). Used to dispatch to the right
// parser.
export function looksLikeAppleMusic(paths: string[]): boolean {
  return paths.some((p) => detectAppleMusicFile(p) !== "unknown");
}

// Minimal RFC-4180-ish CSV parser. Handles double-quoted fields with
// embedded commas, escaped quotes (""), and \r\n / \n line endings.
// Returns rows as string[][].
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote: append one quote, skip the second.
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // swallow; next char (typically \n) ends the row
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      // Skip blank trailing rows
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush last field/row if file didn't end with newline
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

// Build a column-name → index map from the header row, matching
// common variants.
function columnIndex(
  header: string[],
  candidates: string[],
): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

// Split "Song Name by Artist Name" → { trackName, artistName }. Splits
// on the LAST occurrence of " by " to be safe with songs whose titles
// contain "by" (e.g. "Piano Sonata No. 14 by Beethoven" performed by
// some pianist would render as that string in the description).
function splitTrackDescription(
  desc: string,
): { trackName: string; artistName: string } | null {
  if (!desc) return null;
  // Find the LAST " by " occurrence
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  const re = /\s+by\s+/g;
  while ((m = re.exec(desc)) !== null) lastIdx = m.index;
  if (lastIdx < 0) return null;
  const trackName = desc.slice(0, lastIdx).trim();
  const artistName = desc.slice(lastIdx + " by ".length).trim();
  if (!trackName || !artistName) return null;
  return { trackName, artistName };
}

// Parse "Apple Music Play Activity.csv" — the per-play log. Returns
// the Play[] subset we can extract.
export function parsePlayActivityCsv(text: string): Play[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];

  // Column lookups (Apple has shifted these over the years; we accept
  // the common variants).
  const trackDescIdx = columnIndex(header, [
    "Track Description",
    "Song Name",
  ]);
  const trackNameIdx = columnIndex(header, ["Track Name"]);
  const artistNameIdx = columnIndex(header, ["Artist Name"]);
  const albumIdx = columnIndex(header, [
    "Container Description",
    "Album Name",
  ]);
  const eventTypeIdx = columnIndex(header, ["Event Type"]);
  const eventEndIdx = columnIndex(header, [
    "Event End Timestamp",
    "Event Start Timestamp",
    "Event Received Timestamp",
  ]);
  const playDurationIdx = columnIndex(header, [
    "Play Duration Milliseconds",
    "End Position In Milliseconds",
    "Media Duration In Milliseconds",
  ]);
  const playedCompletelyIdx = columnIndex(header, ["Played Completely"]);

  const plays: Play[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0) continue;

    // Filter by event type if available — we only want actual plays,
    // not pause/skip-only events that have null durations.
    if (eventTypeIdx >= 0) {
      const t = row[eventTypeIdx]?.trim().toUpperCase();
      // Common values: PLAY_START, PLAY_END, NOW_PLAYING, etc. PLAY_END
      // is the one with valid duration. If the column doesn't carry
      // PLAY_END at all, fall back to accepting any non-empty row.
      if (t && t !== "PLAY_END" && t !== "END") continue;
    }

    let trackName: string | undefined;
    let artistName: string | undefined;
    if (trackNameIdx >= 0 && artistNameIdx >= 0) {
      trackName = row[trackNameIdx]?.trim();
      artistName = row[artistNameIdx]?.trim();
    } else if (trackDescIdx >= 0) {
      const split = splitTrackDescription(row[trackDescIdx] ?? "");
      if (split) {
        trackName = split.trackName;
        artistName = split.artistName;
      }
    }
    if (!trackName) continue;
    if (!artistName) artistName = "Unknown";

    const tsRaw = eventEndIdx >= 0 ? row[eventEndIdx] : null;
    const ts = tsRaw ? Date.parse(tsRaw) : NaN;
    if (!Number.isFinite(ts)) continue;

    const ms = playDurationIdx >= 0 ? Number(row[playDurationIdx]) : 0;
    const msPlayed = Number.isFinite(ms) && ms > 0 ? ms : 0;

    const completed =
      playedCompletelyIdx >= 0
        ? row[playedCompletelyIdx]?.trim().toLowerCase() === "true"
        : false;

    plays.push({
      ts,
      msPlayed,
      trackName,
      artistName,
      albumName:
        albumIdx >= 0 && row[albumIdx]?.trim()
          ? row[albumIdx].trim()
          : undefined,
      // Apple doesn't expose a Spotify URI; leave it undefined.
      reasonEnd: completed ? "trackdone" : undefined,
    });
  }
  return plays;
}

// Parse "Apple Music - Recently Played Tracks.csv". Smaller format,
// only ~100 rows, no per-event timestamp granularity beyond a single
// "Last Played Date".
export function parseRecentlyPlayedCsv(text: string): Play[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  const trackDescIdx = columnIndex(header, [
    "Track Description",
    "Song Name",
  ]);
  const trackNameIdx = columnIndex(header, ["Track Name"]);
  const artistNameIdx = columnIndex(header, ["Artist Name"]);
  const albumIdx = columnIndex(header, [
    "Container Description",
    "Album Name",
  ]);
  const lastPlayedIdx = columnIndex(header, [
    "Last Played Date",
    "Date Played",
  ]);
  // No play-count or duration in this file — assume one play per row
  // at full track length unknown (set to a default 3 min so the
  // 30s-minimum filter passes).
  const ASSUMED_MS = 3 * 60_000;

  const plays: Play[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    let trackName: string | undefined;
    let artistName: string | undefined;
    if (trackNameIdx >= 0 && artistNameIdx >= 0) {
      trackName = row[trackNameIdx]?.trim();
      artistName = row[artistNameIdx]?.trim();
    } else if (trackDescIdx >= 0) {
      const split = splitTrackDescription(row[trackDescIdx] ?? "");
      if (split) {
        trackName = split.trackName;
        artistName = split.artistName;
      }
    }
    if (!trackName) continue;
    if (!artistName) artistName = "Unknown";

    const tsRaw = lastPlayedIdx >= 0 ? row[lastPlayedIdx] : null;
    const ts = tsRaw ? Date.parse(tsRaw) : NaN;
    if (!Number.isFinite(ts)) continue;

    plays.push({
      ts,
      msPlayed: ASSUMED_MS,
      trackName,
      artistName,
      albumName:
        albumIdx >= 0 && row[albumIdx]?.trim()
          ? row[albumIdx].trim()
          : undefined,
    });
  }
  return plays;
}

// Parse "Apple Music Play History Daily Tracks.csv". Daily aggregates;
// synthesize one Play per day per track at noon-local with
// ms_played = total hours / play count. Loses time-of-day fidelity
// but otherwise works for the constellation.
export function parseDailyTracksCsv(text: string): Play[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  const trackDescIdx = columnIndex(header, ["Track Description"]);
  const trackNameIdx = columnIndex(header, ["Track Name"]);
  const artistNameIdx = columnIndex(header, ["Artist Name"]);
  const albumIdx = columnIndex(header, [
    "Container Description",
    "Album Name",
  ]);
  const dateIdx = columnIndex(header, ["Date Played", "Date"]);
  const hoursIdx = columnIndex(header, ["Hours"]);
  const playsIdx = columnIndex(header, ["Plays"]);

  const plays: Play[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    let trackName: string | undefined;
    let artistName: string | undefined;
    if (trackNameIdx >= 0 && artistNameIdx >= 0) {
      trackName = row[trackNameIdx]?.trim();
      artistName = row[artistNameIdx]?.trim();
    } else if (trackDescIdx >= 0) {
      const split = splitTrackDescription(row[trackDescIdx] ?? "");
      if (split) {
        trackName = split.trackName;
        artistName = split.artistName;
      }
    }
    if (!trackName) continue;
    if (!artistName) artistName = "Unknown";

    // Parse date — Apple uses YYYYMMDD (no separators) sometimes, or
    // YYYY-MM-DD other times.
    const dateRaw = (dateIdx >= 0 ? row[dateIdx] : "")?.trim();
    if (!dateRaw) continue;
    let ts: number;
    if (/^\d{8}$/.test(dateRaw)) {
      const y = Number(dateRaw.slice(0, 4));
      const m = Number(dateRaw.slice(4, 6)) - 1;
      const d = Number(dateRaw.slice(6, 8));
      ts = Date.UTC(y, m, d, 12, 0, 0); // noon UTC, arbitrary
    } else {
      ts = Date.parse(dateRaw);
    }
    if (!Number.isFinite(ts)) continue;

    const hours = hoursIdx >= 0 ? Number(row[hoursIdx]) : 0;
    const playCount = playsIdx >= 0 ? Number(row[playsIdx]) || 1 : 1;
    const totalMs = Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 0;
    // Synthesize one Play row per play count, dividing duration evenly.
    const perPlayMs = playCount > 0 ? totalMs / playCount : 0;
    for (let p = 0; p < playCount; p++) {
      plays.push({
        ts: ts + p * 1000, // jitter so rows aren't identical
        msPlayed: perPlayMs,
        trackName,
        artistName,
        albumName:
          albumIdx >= 0 && row[albumIdx]?.trim()
            ? row[albumIdx].trim()
            : undefined,
      });
    }
  }
  return plays;
}

// Dispatch: given a filename + raw text, return the parsed Plays. Used
// by the top-level parser to handle each entry in an Apple Music ZIP
// or a standalone CSV.
export function parseAppleMusicCsv(
  filename: string,
  text: string,
): { kind: AppleMusicFileKind; plays: Play[] } {
  const kind = detectAppleMusicFile(filename);
  switch (kind) {
    case "play-activity":
      return { kind, plays: parsePlayActivityCsv(text) };
    case "recently-played":
      return { kind, plays: parseRecentlyPlayedCsv(text) };
    case "daily-tracks":
      return { kind, plays: parseDailyTracksCsv(text) };
    default:
      return { kind, plays: [] };
  }
}
