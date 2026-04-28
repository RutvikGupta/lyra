// One-shot test for the Apple Music parser. Verifies the schemas
// match real Apple exports (Play Activity uses Song Name +
// Container Artist Name; Recently Played + Daily Tracks use
// Track Description in "Artist - Song" format).
//
// Run with:
//   node --experimental-strip-types --no-warnings scripts/test-apple-parser.mjs

import { parseAppleMusicCsv } from "../lib/apple-music-parser.ts";

// --- Play Activity (real schema) ---
const playActivityCsv = `Album Name,Apple ID Number,Container Artist Name,Container Type,End Position In Milliseconds,End Reason Type,Event End Timestamp,Event Type,Media Duration In Milliseconds,Play Duration Milliseconds,Song Name
A Night at the Opera,0,Queen,ALBUM,354000,NATURAL_END_OF_TRACK,2024-03-15T18:42:31Z,PLAY_END,354000,354000,Bohemian Rhapsody
Melophobia,0,Cage The Elephant,ALBUM,235000,NATURAL_END_OF_TRACK,2024-03-15T18:48:10Z,PLAY_END,235000,235000,Cigarette Daydreams
Graduation,0,Kanye West,ALBUM,312000,TRACK_SKIPPED_FORWARDS,2024-03-15T18:52:22Z,PLAY_END,312000,312000,Stronger
Fine Line,0,Harry Styles,ALBUM,45000,TRACK_SKIPPED_FORWARDS,2024-03-15T18:53:00Z,PAUSE,174000,45000,Watermelon Sugar
"An Album, with comma",0,Some Artist,ALBUM,180000,NATURAL_END_OF_TRACK,2024-03-15T19:00:00Z,PLAY_END,180000,180000,"Title, with comma"
Quoted Album,0,Another Artist,ALBUM,220000,NATURAL_END_OF_TRACK,2024-03-15T19:05:00Z,PLAY_END,220000,220000,"Title with ""quotes"""
,0,,,,,2024-03-15T19:10:00Z,PLAY_END,200000,200000,Orphaned Track
`;

const recentlyCsv = `Last Modified,Container Type,Container Description,Track Description,Country,First Event Timestamp,Last End Reason Tyoe,Last Event End Timestamp,Total plays,Total play duration in millis
2024-03-24T04:00:52.889Z,Album,Joe Hisaishi - Spirited Away (Original Soundtrack),Joe Hisaishi - The Stink God,United States,2024-03-24T04:00:52.889Z,PLAYBACK_MANUALLY_PAUSED,2024-03-24T04:03:41.580Z,2,168691
2024-03-24T03:58:25.955Z,Album,Joe Hisaishi - Spirited Away (Original Soundtrack),Joe Hisaishi - It's Hard Work,United States,2024-03-24T03:58:25.955Z,NATURAL_END_OF_TRACK,2024-03-24T04:00:52.896Z,1,146941
2024-03-25T14:00:00.000Z,Album,Queen - A Night at the Opera,Queen - Bohemian Rhapsody,United States,2024-03-25T14:00:00.000Z,NATURAL_END_OF_TRACK,2024-03-25T14:06:00.000Z,3,1062000
`;

const dailyCsv = `Country,Track Identifier,Media type,Date Played,Hours,Play Duration Milliseconds,End Reason Type,Source Type,Play Count,Skip Count,Track Description
United States,978194965,N/A,20150630,"18, 19",1664000,NATURAL_END_OF_TRACK,IPHONE,7,4,Brian Eno - 1/2
United States,724436401,N/A,20150630,16,565000,NATURAL_END_OF_TRACK,IPHONE,4,3,The Beatles - Hey Jude
United States,123,N/A,20150701,12,235000,NATURAL_END_OF_TRACK,IPHONE,1,0,Cage The Elephant - Cigarette Daydreams
`;

function check(label, condition, detail = "") {
  const status = condition ? "PASS" : "FAIL";
  console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) process.exitCode = 1;
}

// --- Play Activity ---
console.log("\n=== Apple Music Play Activity.csv (real schema) ===");
const pa = parseAppleMusicCsv(
  "Apple Music Play Activity.csv",
  playActivityCsv,
);
console.log(`kind: ${pa.kind}, plays: ${pa.plays.length}`);
check("kind detected as play-activity", pa.kind === "play-activity");
// 7 rows minus 1 PAUSE = 6 plays
check("PAUSE row dropped", pa.plays.length === 6, `got ${pa.plays.length}`);
const queen = pa.plays.find((p) => p.trackName === "Bohemian Rhapsody");
check(
  "Song Name → trackName",
  queen?.trackName === "Bohemian Rhapsody",
);
check(
  "Container Artist Name → artistName",
  queen?.artistName === "Queen",
);
check(
  "Album Name → albumName",
  queen?.albumName === "A Night at the Opera",
);
check(
  "msPlayed from Play Duration Milliseconds",
  queen?.msPlayed === 354000,
  `got ${queen?.msPlayed}`,
);
check(
  "NATURAL_END_OF_TRACK → reasonEnd=trackdone",
  queen?.reasonEnd === "trackdone",
);
const skipped = pa.plays.find((p) => p.trackName === "Stronger");
check(
  "TRACK_SKIPPED_FORWARDS → reasonEnd undefined",
  skipped?.reasonEnd === undefined,
);
const comma = pa.plays.find((p) => p.trackName === "Title, with comma");
check("title with embedded comma parsed", !!comma);
const quotes = pa.plays.find((p) => p.trackName === 'Title with "quotes"');
check("escaped quotes round-tripped", !!quotes);
const orphan = pa.plays.find((p) => p.trackName === "Orphaned Track");
check(
  "row with empty Container Artist Name → artistName='Unknown'",
  orphan?.artistName === "Unknown",
  `got ${orphan?.artistName}`,
);

// --- Recently Played (real schema, with Apple's Tyoe typo) ---
console.log("\n=== Apple Music - Recently Played Tracks.csv ===");
const rp = parseAppleMusicCsv(
  "Apple Music - Recently Played Tracks.csv",
  recentlyCsv,
);
console.log(`kind: ${rp.kind}, plays: ${rp.plays.length}`);
check("kind detected as recently-played", rp.kind === "recently-played");
// Total plays across the 3 rows: 2 + 1 + 3 = 6 synthesized plays
check(
  "Total plays expanded into per-play rows",
  rp.plays.length === 6,
  `got ${rp.plays.length}`,
);
const stink = rp.plays.find((p) => p.trackName === "The Stink God");
check(
  "Track Description split on ' - ' (artist FIRST)",
  stink?.artistName === "Joe Hisaishi" && stink?.trackName === "The Stink God",
);
check(
  "Container Description album extracted",
  stink?.albumName === "Spirited Away (Original Soundtrack)",
);
check(
  "Apple's 'Last End Reason Tyoe' typo handled",
  // Stink had PLAYBACK_MANUALLY_PAUSED → not completed
  stink?.reasonEnd === undefined,
);
const hisHardWork = rp.plays.find((p) => p.trackName === "It's Hard Work");
check(
  "NATURAL_END_OF_TRACK on Recently Played → reasonEnd=trackdone",
  hisHardWork?.reasonEnd === "trackdone",
);

// --- Daily Tracks (real schema with comma-separated Hours) ---
console.log("\n=== Apple Music Play History Daily Tracks.csv ===");
const dt = parseAppleMusicCsv(
  "Apple Music Play History Daily Tracks.csv",
  dailyCsv,
);
console.log(`kind: ${dt.kind}, plays: ${dt.plays.length}`);
check("kind detected as daily-tracks", dt.kind === "daily-tracks");
// Play Count totals: 7 + 4 + 1 = 12
check(
  "Play Count expanded to per-play rows",
  dt.plays.length === 12,
  `got ${dt.plays.length}`,
);
const eno = dt.plays.find((p) => p.trackName === "1/2");
check(
  "daily Track Description split on ' - '",
  eno?.artistName === "Brian Eno" && eno?.trackName === "1/2",
);
const enoHour = new Date(eno?.ts ?? 0).getUTCHours();
check(
  "first Hour value (18 from '18, 19') used as base hour",
  enoHour === 18,
  `got UTC hour ${enoHour}`,
);
const cig = dt.plays.find((p) => p.trackName === "Cigarette Daydreams");
check(
  "single-int Hours value parsed",
  new Date(cig?.ts ?? 0).getUTCHours() === 12,
);

// --- Aggregation roll-up ---
console.log("\n=== Aggregation roll-up (Play Activity) ===");
const MIN_MS = 30_000;
const realPlays = pa.plays.filter((p) => p.msPlayed >= MIN_MS);
const tracksByKey = new Map();
const artistsByKey = new Map();
for (const p of realPlays) {
  const tk = `name:${p.trackName.toLowerCase()}::${p.artistName.toLowerCase()}`;
  const t = tracksByKey.get(tk);
  if (t) {
    t.playCount++;
  } else {
    tracksByKey.set(tk, { name: p.trackName, artist: p.artistName, playCount: 1 });
  }
  const ak = p.artistName.toLowerCase();
  artistsByKey.set(ak, (artistsByKey.get(ak) ?? 0) + 1);
}
console.log(
  `realPlays=${realPlays.length}, tracks=${tracksByKey.size}, artists=${artistsByKey.size}`,
);
// 6 plays survive (all PLAY_END rows have msPlayed >= 45000 except the
// PAUSE row which was already dropped); 6 unique tracks; 6 unique
// artists + 1 "Unknown".
check("6 plays survive 30s filter", realPlays.length === 6);
check("6 unique tracks", tracksByKey.size === 6);
// Harry Styles was only on the PAUSE row, which is dropped, so the
// surviving artists are: Queen, Cage The Elephant, Kanye West, Some
// Artist, Another Artist, Unknown — 6.
check(
  "6 unique artists incl. Unknown",
  artistsByKey.size === 6,
  Array.from(artistsByKey.keys()).join(" | "),
);

console.log(
  "\n" + (process.exitCode ? "Some checks failed" : "All checks passed"),
);
