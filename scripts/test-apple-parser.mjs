// One-shot script to exercise the Apple Music parser with synthetic
// data shaped like an actual export. Run with:
//
//   npx tsx scripts/test-apple-parser.mjs
//
// Prints a summary of the parsed plays + aggregated tracks/artists so
// we can sanity-check the end-to-end shape without having to drag a
// real CSV onto the dev server.

import {
  parseAppleMusicCsv,
} from "../lib/apple-music-parser.ts";

// Realistic-looking Play Activity CSV. Column names match Apple's
// 2023+ export schema. Includes a few quirks worth testing:
//   - quoted field with embedded comma
//   - escaped double-quote ("")
//   - Track Description in "Song by Artist" form
//   - mix of PLAY_END (kept) and PAUSE (dropped)
//   - completed vs. not completed
const playActivityCsv = `"Apple Id Number","Track Description","Container Description","Container Type","End Position In Milliseconds","End Reason Type","Event End Timestamp","Event Type","Hardware Type","Item Type","Media Duration In Milliseconds","Media Type","Played Completely","Source Type","Store Country Name"
"123","Bohemian Rhapsody by Queen","A Night at the Opera","ALBUM","354000","NATURAL_END_OF_TRACK","2024-03-15T18:42:31Z","PLAY_END","iPhone","SONG","354000","SONG","TRUE","LIBRARY","USA"
"123","Cigarette Daydreams by Cage The Elephant","Melophobia","ALBUM","235000","NATURAL_END_OF_TRACK","2024-03-15T18:48:10Z","PLAY_END","iPhone","SONG","235000","SONG","TRUE","LIBRARY","USA"
"123","Stronger by Kanye West","Graduation","ALBUM","312000","TRACK_SKIPPED_FORWARDS","2024-03-15T18:52:22Z","PLAY_END","iPhone","SONG","312000","SONG","FALSE","LIBRARY","USA"
"123","Cigarette Daydreams by Cage The Elephant","Melophobia","ALBUM","235000","NATURAL_END_OF_TRACK","2024-03-16T09:14:55Z","PLAY_END","iPhone","SONG","235000","SONG","TRUE","LIBRARY","USA"
"123","Watermelon Sugar by Harry Styles","Fine Line","ALBUM","174000","NATURAL_END_OF_TRACK","2024-03-16T09:18:01Z","PLAY_END","iPhone","SONG","174000","SONG","TRUE","LIBRARY","USA"
"123","Watermelon Sugar by Harry Styles","Fine Line","ALBUM","45000","TRACK_SKIPPED_FORWARDS","2024-03-16T09:18:46Z","PAUSE","iPhone","SONG","174000","SONG","FALSE","LIBRARY","USA"
"123","Sweet Caroline by Neil Diamond","Brother Love's Travelling Salvation Show","ALBUM","202000","NATURAL_END_OF_TRACK","2024-03-17T12:00:00Z","PLAY_END","iPhone","SONG","202000","SONG","TRUE","LIBRARY","USA"
"123","Title, with comma by Some Artist","An Album, with comma","ALBUM","180000","NATURAL_END_OF_TRACK","2024-03-17T12:05:00Z","PLAY_END","iPhone","SONG","180000","SONG","TRUE","LIBRARY","USA"
"123","Title with ""quotes"" by Another Artist","Quoted Album","ALBUM","220000","NATURAL_END_OF_TRACK","2024-03-17T12:10:00Z","PLAY_END","iPhone","SONG","220000","SONG","TRUE","LIBRARY","USA"
`;

const recentlyCsv = `"Track Description","Container Description","Last Played Date"
"Bohemian Rhapsody by Queen","A Night at the Opera","2024-03-15T18:42:31Z"
"Stronger by Kanye West","Graduation","2024-03-15T18:52:22Z"
`;

const dailyCsv = `"Track Description","Date Played","Hours","Plays"
"Bohemian Rhapsody by Queen","20240315","0.118","2"
"Cigarette Daydreams by Cage The Elephant","20240316","0.130","2"
"Watermelon Sugar by Harry Styles","20240316","0.058","1"
`;

function check(label, condition, detail = "") {
  const status = condition ? "PASS" : "FAIL";
  console.log(`[${status}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) process.exitCode = 1;
}

// --- Play Activity ---
console.log("\n=== Apple Music Play Activity.csv ===");
const pa = parseAppleMusicCsv(
  "Apple Music Play Activity.csv",
  playActivityCsv,
);
console.log(`kind: ${pa.kind}, plays: ${pa.plays.length}`);
check("kind detected as play-activity", pa.kind === "play-activity");
// We expect 8 plays (9 rows minus the PAUSE row).
check("PAUSE row dropped", pa.plays.length === 8, `got ${pa.plays.length}`);
const titles = new Set(pa.plays.map((p) => p.trackName));
check(
  "title with embedded comma parsed",
  titles.has("Title, with comma"),
  Array.from(titles).join(" | "),
);
check(
  "escaped quotes round-tripped",
  titles.has('Title with "quotes"'),
);
check(
  "artist after 'by' extracted",
  pa.plays.some(
    (p) =>
      p.trackName === "Bohemian Rhapsody" && p.artistName === "Queen",
  ),
);
check(
  "msPlayed set from End Position",
  pa.plays[0].msPlayed === 354000,
  `got ${pa.plays[0].msPlayed}`,
);
check(
  "completed flag → reasonEnd=trackdone",
  pa.plays[0].reasonEnd === "trackdone",
);
check(
  "skip flag → reasonEnd undefined",
  pa.plays.find(
    (p) =>
      p.trackName === "Stronger" && p.artistName === "Kanye West",
  )?.reasonEnd === undefined,
);

// --- Recently Played ---
console.log("\n=== Apple Music - Recently Played Tracks.csv ===");
const rp = parseAppleMusicCsv(
  "Apple Music - Recently Played Tracks.csv",
  recentlyCsv,
);
console.log(`kind: ${rp.kind}, plays: ${rp.plays.length}`);
check("kind detected as recently-played", rp.kind === "recently-played");
check("recently-played count", rp.plays.length === 2);

// --- Daily Tracks ---
console.log("\n=== Apple Music Play History Daily Tracks.csv ===");
const dt = parseAppleMusicCsv(
  "Apple Music Play History Daily Tracks.csv",
  dailyCsv,
);
console.log(`kind: ${dt.kind}, plays: ${dt.plays.length}`);
check("kind detected as daily-tracks", dt.kind === "daily-tracks");
// Daily synthesizes plays-count rows per row: 2 + 2 + 1 = 5
check("daily-tracks expanded to per-play rows", dt.plays.length === 5);

// --- Inline aggregation ---------------------------------------------
// parseFiles() in lib/parser.ts wires the CSV plays through a generic
// aggregation step. Reproduce just enough of that logic here to verify
// the per-track / per-artist roll-up works on Apple Music input,
// without crossing the Node-vs-TypeScript-import boundary.
console.log("\n=== Aggregation roll-up ===");
const MIN_MS = 30_000;
const realPlays = pa.plays.filter((p) => p.msPlayed >= MIN_MS);
const tracksByKey = new Map();
const artistsByKey = new Map();
for (const p of realPlays) {
  const tk = `name:${p.trackName.toLowerCase()}::${p.artistName.toLowerCase()}`;
  const t = tracksByKey.get(tk);
  if (t) {
    t.playCount++;
    t.totalMsPlayed += p.msPlayed;
  } else {
    tracksByKey.set(tk, {
      name: p.trackName,
      artist: p.artistName,
      playCount: 1,
      totalMsPlayed: p.msPlayed,
    });
  }
  const ak = p.artistName.toLowerCase();
  const a = artistsByKey.get(ak);
  if (a) {
    a.playCount++;
    a.totalMsPlayed += p.msPlayed;
  } else {
    artistsByKey.set(ak, {
      name: p.artistName,
      playCount: 1,
      totalMsPlayed: p.msPlayed,
    });
  }
}
console.log(
  `realPlays=${realPlays.length}, tracks=${tracksByKey.size}, ` +
    `artists=${artistsByKey.size}`,
);
check(
  "all 8 PLAY_END rows survive the 30s filter",
  realPlays.length === 8,
  `got ${realPlays.length}`,
);
// 7 unique tracks: Bohemian Rhapsody, Cigarette Daydreams (×2 plays),
// Stronger, Watermelon Sugar (×1 — second was PAUSE & dropped earlier),
// Sweet Caroline, Title-with-comma, Title-with-quotes
check(
  "tracks de-duplicated by name+artist",
  tracksByKey.size === 7,
  `got ${tracksByKey.size}`,
);
const cigarette = Array.from(tracksByKey.values()).find(
  (t) => t.name === "Cigarette Daydreams",
);
check(
  "Cigarette Daydreams has 2 plays",
  cigarette?.playCount === 2,
  `got ${cigarette?.playCount}`,
);
check(
  "artists de-duplicated",
  artistsByKey.size === 7, // Queen, Cage The Elephant, Kanye West, Harry Styles, Neil Diamond, Some Artist, Another Artist
  `got ${artistsByKey.size}`,
);

console.log(
  "\n" +
    (process.exitCode ? "Some checks failed" : "All checks passed"),
);
