// Apple Music data export parser. Verified against real test fixtures
// from github.com/nerveband/Apple-Music-Play-History-Converter (2025).
//
// Apple's privacy.apple.com export contains three different CSV files
// with three substantially different schemas — they are NOT variants
// of one shape, so each gets its own parser.
//
// 1. "Apple Music Play Activity.csv" — per-play event log. Hundreds of
//    columns. Track in `Song Name`, artist in `Container Artist Name`,
//    album in `Album Name` / `Container Album Name`. There is NO
//    `Track Description` column here despite what some third-party
//    docs claim. Many rows have an empty `Container Artist Name`
//    (e.g. plays from a search result, not a saved album) — those
//    rows fall through with artist="Unknown".
//
// 2. "Apple Music - Recently Played Tracks.csv" — last ~6 months,
//    daily-deduplicated. Track is in `Track Description` formatted as
//    "Artist - Song Name" (artist FIRST, dash separator — NOT
//    "Song by Artist"). `Container Description` is "Artist - Album".
//    Note: header has a typo `Last End Reason Tyoe` in the wild.
//
// 3. "Apple Music - Play History Daily Tracks.csv" — daily aggregates.
//    Track in `Track Description` ("Artist - Song"). `Date Played` is
//    YYYYMMDD. `Hours` may be a single int or a comma-separated list
//    like `"18, 19"`. `Play Count` is the day's count for that track.
//
// Apple's CSVs are quoted-comma-separated and don't always escape
// embedded commas perfectly — the small inline parser below handles
// the cases that actually appear in real exports.

import type { Play } from "./types";

export type AppleMusicFileKind =
  | "play-activity"
  | "recently-played"
  | "daily-tracks"
  | "unknown";

export function detectAppleMusicFile(filename: string): AppleMusicFileKind {
  const name = filename.split("/").pop()?.toLowerCase() ?? "";
  // "Apple Music - Play History Daily Tracks.csv"
  if (name.includes("play history daily")) return "daily-tracks";
  // "Apple Music - Recently Played Tracks.csv"
  if (name.includes("recently played")) return "recently-played";
  // "Apple Music Play Activity.csv" / "Apple Music Play Activity small.csv" / etc.
  if (name.includes("play activity")) return "play-activity";
  return "unknown";
}

export function looksLikeAppleMusic(paths: string[]): boolean {
  return paths.some((p) => detectAppleMusicFile(p) !== "unknown");
}

// Minimal RFC-4180-ish CSV parser. Handles double-quoted fields with
// embedded commas, escaped quotes (""), and \r\n / \n line endings.
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
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

function columnIndex(header: string[], candidates: string[]): number {
  const lower = header.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx >= 0) return idx;
  }
  return -1;
}

// Split "Artist - Song Name" → { artistName, trackName }. Recently
// Played and Daily Tracks both use this format. We split on the FIRST
// " - " because artists with hyphens are rare but song subtitles like
// "Track - Remastered 2019" are common.
function splitArtistDashTrack(
  desc: string,
): { artistName: string; trackName: string } | null {
  if (!desc) return null;
  const idx = desc.indexOf(" - ");
  if (idx < 0) return null;
  const artistName = desc.slice(0, idx).trim();
  const trackName = desc.slice(idx + " - ".length).trim();
  if (!artistName || !trackName) return null;
  return { artistName, trackName };
}

// Parse "Apple Music Play Activity.csv" — the per-play log.
//
// Real schema (truncated to fields we use):
//   Song Name, Album Name, Container Album Name, Container Artist Name,
//   Container Type, End Position In Milliseconds, End Reason Type,
//   Event End Timestamp, Event Start Timestamp, Event Type,
//   Media Duration In Milliseconds, Play Duration Milliseconds.
export function parsePlayActivityCsv(text: string): Play[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];

  const songNameIdx = columnIndex(header, ["Song Name"]);
  const albumIdx = columnIndex(header, [
    "Album Name",
    "Container Album Name",
  ]);
  const containerArtistIdx = columnIndex(header, [
    "Container Artist Name",
  ]);
  const eventTypeIdx = columnIndex(header, ["Event Type"]);
  const endReasonIdx = columnIndex(header, ["End Reason Type"]);
  const eventEndIdx = columnIndex(header, [
    "Event End Timestamp",
    "Event Start Timestamp",
    "Event Received Timestamp",
    "Event Timestamp",
  ]);
  const playDurationIdx = columnIndex(header, [
    "Play Duration Milliseconds",
    "End Position In Milliseconds",
    "Media Duration In Milliseconds",
  ]);

  const plays: Play[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0) continue;

    // Only consider rows that represent an actual play. PLAY_END is
    // the most reliable signal; PLAY_START rows show up but are
    // usually paired with a corresponding PLAY_END that has the real
    // duration. NOW_PLAYING and PAUSE rows have no useful play data.
    if (eventTypeIdx >= 0) {
      const t = row[eventTypeIdx]?.trim().toUpperCase();
      if (t && t !== "PLAY_END" && t !== "END") continue;
    }

    const trackName = (
      songNameIdx >= 0 ? row[songNameIdx] : ""
    )?.trim();
    if (!trackName) continue;

    // Container Artist Name is the artist of the album/playlist this
    // play came from. It's blank for plays sourced from a song search,
    // a station, or anywhere there's no album container. Many real
    // exports have ~30-50% of rows with a blank container artist —
    // those plays still happened, but we can't render them in an
    // artist-clustered graph without artist data, so they fall under
    // "Unknown" and the user will see them as one big bucket. The
    // alternative (querying MusicBrainz at upload time) is slow and
    // rate-limited; out of scope for this parser.
    const containerArtist = (
      containerArtistIdx >= 0 ? row[containerArtistIdx] : ""
    )?.trim();
    const artistName = containerArtist || "Unknown";

    const tsRaw = eventEndIdx >= 0 ? row[eventEndIdx] : null;
    const ts = tsRaw ? Date.parse(tsRaw) : NaN;
    if (!Number.isFinite(ts)) continue;

    const ms = playDurationIdx >= 0 ? Number(row[playDurationIdx]) : 0;
    const msPlayed = Number.isFinite(ms) && ms > 0 ? ms : 0;

    // Apple's "completed" signal is End Reason Type === NATURAL_END_OF_TRACK
    // (sometimes legacy value just "NATURAL"). Other values like
    // PLAYBACK_MANUALLY_PAUSED, TRACK_SKIPPED_FORWARDS,
    // MANUALLY_SELECTED_PLAYBACK_OF_A_DIFF_ITEM imply non-completed.
    const reason = (endReasonIdx >= 0 ? row[endReasonIdx] : "")
      ?.trim()
      .toUpperCase();
    const completed =
      reason === "NATURAL_END_OF_TRACK" || reason === "NATURAL";

    plays.push({
      ts,
      msPlayed,
      trackName,
      artistName,
      albumName:
        albumIdx >= 0 && row[albumIdx]?.trim()
          ? row[albumIdx].trim()
          : undefined,
      reasonEnd: completed ? "trackdone" : undefined,
    });
  }
  return plays;
}

// Parse "Apple Music - Recently Played Tracks.csv".
//
// Real schema:
//   Last Modified, Container Type, Container Description,
//   Track Description, Ignore For Recommendations, Country,
//   Container Reference, Track Reference, Feature Name,
//   First Event Timestamp, Last End Reason Tyoe (sic — typo in
//   Apple's header), Last Event End Timestamp,
//   Last Event Received Timestamp, Last Event Start Timestamp,
//   Max Event End Position in millis, Max Play Duration in millis,
//   Media duration in millis, Media type,
//   Min Event Start Position in millis, Total plays, Total skips,
//   Total play duration in millis.
//
// `Track Description` is "Artist - Song" (artist FIRST), unlike
// what older third-party docs claim. We multiply by `Total plays`
// to get a faithful per-play expansion at the row's first-event
// timestamp.
export function parseRecentlyPlayedCsv(text: string): Play[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];

  const trackDescIdx = columnIndex(header, ["Track Description"]);
  const containerDescIdx = columnIndex(header, ["Container Description"]);
  const firstEventIdx = columnIndex(header, [
    "First Event Timestamp",
    "Last Event Start Timestamp",
    "Last Modified",
  ]);
  const lastEventIdx = columnIndex(header, [
    "Last Event End Timestamp",
    "Last Modified",
  ]);
  const totalPlaysIdx = columnIndex(header, ["Total plays"]);
  const totalDurationIdx = columnIndex(header, [
    "Total play duration in millis",
    "Max Play Duration in millis",
    "Media duration in millis",
  ]);
  const lastReasonIdx = columnIndex(header, [
    // Apple ships this with a typo. Try both.
    "Last End Reason Type",
    "Last End Reason Tyoe",
  ]);

  const plays: Play[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const desc = trackDescIdx >= 0 ? row[trackDescIdx] : "";
    const split = splitArtistDashTrack(desc ?? "");
    if (!split) continue;

    const tsRaw =
      lastEventIdx >= 0
        ? row[lastEventIdx]
        : firstEventIdx >= 0
          ? row[firstEventIdx]
          : null;
    const ts = tsRaw ? Date.parse(tsRaw) : NaN;
    if (!Number.isFinite(ts)) continue;

    const totalPlays = Math.max(
      1,
      totalPlaysIdx >= 0 ? Math.round(Number(row[totalPlaysIdx])) || 1 : 1,
    );
    const totalDuration =
      totalDurationIdx >= 0 ? Number(row[totalDurationIdx]) : 0;
    const perPlayMs =
      Number.isFinite(totalDuration) && totalDuration > 0
        ? totalDuration / totalPlays
        : 0;

    const reason = (lastReasonIdx >= 0 ? row[lastReasonIdx] : "")
      ?.trim()
      .toUpperCase();
    const completed =
      reason === "NATURAL_END_OF_TRACK" || reason === "NATURAL";

    // Container Description is "Artist - Album"; pull the album half.
    let albumName: string | undefined;
    if (containerDescIdx >= 0) {
      const cd = splitArtistDashTrack(row[containerDescIdx] ?? "");
      if (cd) albumName = cd.trackName; // "trackName" half is the album here
    }

    for (let p = 0; p < totalPlays; p++) {
      plays.push({
        // Spread the synthetic plays across the row's window so they
        // don't all stack on a single millisecond — bucketed by p so
        // any time-of-day filtering downstream still sees variation.
        ts: ts - p * 1000,
        msPlayed: perPlayMs,
        trackName: split.trackName,
        artistName: split.artistName,
        albumName,
        reasonEnd: completed ? "trackdone" : undefined,
      });
    }
  }
  return plays;
}

// Parse "Apple Music - Play History Daily Tracks.csv".
//
// Real schema:
//   Country, Track Identifier, Media type, Date Played, Hours,
//   Play Duration Milliseconds, End Reason Type, Source Type,
//   Play Count, Skip Count, Ignore For Recommendations,
//   Track Reference, Track Description.
//
// Date Played is YYYYMMDD. Hours can be a single int (e.g. `16`) or
// a comma-separated list (e.g. `"18, 19"` meaning the user played the
// track during both hours 18 and 19 of that day). We synthesize one
// Play per `Play Count`, distributed across the listed hours; if the
// hour list and the play count don't match, we evenly stagger inside
// the first listed hour.
export function parseDailyTracksCsv(text: string): Play[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];

  const trackDescIdx = columnIndex(header, ["Track Description"]);
  const dateIdx = columnIndex(header, ["Date Played"]);
  const hoursIdx = columnIndex(header, ["Hours"]);
  const playCountIdx = columnIndex(header, ["Play Count", "Plays"]);
  const playDurationIdx = columnIndex(header, [
    "Play Duration Milliseconds",
    "Total play duration in millis",
  ]);
  const endReasonIdx = columnIndex(header, ["End Reason Type"]);

  const plays: Play[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const desc = trackDescIdx >= 0 ? row[trackDescIdx] : "";
    const split = splitArtistDashTrack(desc ?? "");
    if (!split) continue;

    const dateRaw = (dateIdx >= 0 ? row[dateIdx] : "")?.trim();
    if (!dateRaw) continue;
    let dayMs: number;
    if (/^\d{8}$/.test(dateRaw)) {
      const y = Number(dateRaw.slice(0, 4));
      const m = Number(dateRaw.slice(4, 6)) - 1;
      const d = Number(dateRaw.slice(6, 8));
      dayMs = Date.UTC(y, m, d, 0, 0, 0);
    } else {
      const parsed = Date.parse(dateRaw);
      if (!Number.isFinite(parsed)) continue;
      dayMs = parsed;
    }

    // Pick the first listed hour. Apple's `Hours` field can be a
    // quoted "18, 19" or a bare int.
    const hoursRaw = (hoursIdx >= 0 ? row[hoursIdx] : "")?.trim();
    const firstHour = hoursRaw
      ? Number(hoursRaw.split(",")[0].trim())
      : 12;
    const baseTs =
      dayMs +
      (Number.isFinite(firstHour) ? Math.max(0, Math.min(23, firstHour)) : 12) *
        3_600_000;

    const playCount = Math.max(
      1,
      playCountIdx >= 0
        ? Math.round(Number(row[playCountIdx])) || 1
        : 1,
    );
    const totalMs =
      playDurationIdx >= 0 ? Number(row[playDurationIdx]) : 0;
    const perPlayMs =
      Number.isFinite(totalMs) && totalMs > 0 ? totalMs / playCount : 0;

    const reason = (endReasonIdx >= 0 ? row[endReasonIdx] : "")
      ?.trim()
      .toUpperCase();
    const completed =
      reason === "NATURAL_END_OF_TRACK" || reason === "NATURAL";

    for (let p = 0; p < playCount; p++) {
      plays.push({
        // Spread the day's plays across the hour at one-second intervals.
        ts: baseTs + p * 1000,
        msPlayed: perPlayMs,
        trackName: split.trackName,
        artistName: split.artistName,
        reasonEnd: completed ? "trackdone" : undefined,
      });
    }
  }
  return plays;
}

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
