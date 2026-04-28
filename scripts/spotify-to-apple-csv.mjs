// Convert a Spotify "Extended streaming history" ZIP into an
// Apple-Music-shaped "Apple Music Play Activity.csv" file. Lets us
// drive the Apple Music upload path with realistic data we already
// have (full play counts, real timestamps, real artists) instead of
// a tiny synthetic fixture.
//
// Field mapping:
//   Spotify ts                            → Event End Timestamp
//   master_metadata_track_name + artist   → Track Description ("X by Y")
//   master_metadata_album_album_name      → Container Description
//   ms_played                             → End Position In Milliseconds
//                                           and Media Duration In Milliseconds
//   reason_end === "trackdone"            → Played Completely (TRUE/FALSE)
//
// Usage:
//   node scripts/spotify-to-apple-csv.mjs <input.zip> <output.csv>
//
// Defaults:
//   input  = ~/Downloads/my_spotify_data.zip
//   output = ./fixtures/Apple Music Play Activity (from Spotify).csv

import { createWriteStream, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";

const argv = process.argv.slice(2);
const inputZip =
  argv[0] ?? join(homedir(), "Downloads", "my_spotify_data.zip");
const outputCsv =
  argv[1] ??
  join(
    process.cwd(),
    "fixtures",
    "Apple Music Play Activity (from Spotify).csv",
  );

console.log(`reading: ${inputZip}`);
const zipBuf = new Uint8Array(await readFile(inputZip));
const entries = unzipSync(zipBuf);

const historyFiles = Object.entries(entries).filter(([path]) => {
  const name = path.split("/").pop() ?? "";
  if (name.startsWith(".") || name.startsWith("__MACOSX")) return false;
  return /^Streaming_?History.*\.json$/i.test(name);
});

if (historyFiles.length === 0) {
  console.error(
    "No StreamingHistory*.json files in the ZIP. Make sure you " +
      "ticked 'Extended streaming history' when requesting the data.",
  );
  process.exit(1);
}
console.log(
  `found ${historyFiles.length} streaming-history file(s):`,
  historyFiles.map(([p]) => p),
);

// CSV writers — same column set as the real Apple export so the parser
// hits all the same code paths. We keep it minimal but include every
// field our parser reads.
const COLUMNS = [
  "Apple Id Number",
  "Track Description",
  "Container Description",
  "Container Type",
  "End Position In Milliseconds",
  "End Reason Type",
  "Event End Timestamp",
  "Event Type",
  "Hardware Type",
  "Item Type",
  "Media Duration In Milliseconds",
  "Media Type",
  "Played Completely",
  "Source Type",
  "Store Country Name",
];

function csvField(s) {
  const str = String(s ?? "");
  // Always quote — simpler than deciding when, and matches Apple's
  // format which wraps every field.
  return `"${str.replace(/"/g, '""')}"`;
}

mkdirSync(dirname(outputCsv), { recursive: true });
const out = createWriteStream(outputCsv, { encoding: "utf8" });
out.write(COLUMNS.map((c) => csvField(c)).join(",") + "\n");

let rowsIn = 0;
let rowsOut = 0;
let earliest = Infinity;
let latest = -Infinity;

for (const [path, data] of historyFiles) {
  const text = new TextDecoder().decode(data);
  let arr;
  try {
    arr = JSON.parse(text);
  } catch (err) {
    console.warn(`skip ${path}: invalid JSON (${err.message})`);
    continue;
  }
  if (!Array.isArray(arr)) {
    console.warn(`skip ${path}: not an array`);
    continue;
  }

  for (const entry of arr) {
    rowsIn++;

    // Extended-history shape vs. account-data shape
    const isExtended =
      entry.master_metadata_track_name !== undefined ||
      entry.spotify_track_uri !== undefined ||
      entry.ts !== undefined;
    let trackName, artistName, albumName, ts, msPlayed, completed;

    if (isExtended) {
      if (!entry.master_metadata_track_name) continue;
      trackName = entry.master_metadata_track_name;
      artistName = entry.master_metadata_album_artist_name ?? "Unknown";
      albumName = entry.master_metadata_album_album_name ?? "";
      ts = entry.ts;
      msPlayed = Number(entry.ms_played) || 0;
      completed = entry.reason_end === "trackdone";
    } else {
      // 12-month account-data shape
      if (!entry.trackName) continue;
      trackName = entry.trackName;
      artistName = entry.artistName ?? "Unknown";
      albumName = "";
      ts = entry.endTime;
      msPlayed = Number(entry.msPlayed) || 0;
      completed = msPlayed >= 30_000;
    }

    if (!ts) continue;
    const tsMs = Date.parse(ts);
    if (!Number.isFinite(tsMs)) continue;
    if (tsMs < earliest) earliest = tsMs;
    if (tsMs > latest) latest = tsMs;

    // Match Apple's output formatting (trailing Z is fine; both formats
    // pass Date.parse on the read side).
    const tsIso = new Date(tsMs).toISOString();

    const row = [
      "0", // Apple Id Number
      `${trackName} by ${artistName}`, // Track Description
      albumName, // Container Description
      "ALBUM", // Container Type
      String(msPlayed), // End Position In Milliseconds
      completed ? "NATURAL_END_OF_TRACK" : "TRACK_SKIPPED_FORWARDS",
      tsIso, // Event End Timestamp
      "PLAY_END", // Event Type
      "iPhone", // Hardware Type
      "SONG", // Item Type
      String(msPlayed), // Media Duration In Milliseconds (best guess)
      "SONG", // Media Type
      completed ? "TRUE" : "FALSE", // Played Completely
      "LIBRARY", // Source Type
      "USA", // Store Country Name
    ];
    out.write(row.map((f) => csvField(f)).join(",") + "\n");
    rowsOut++;
  }
}

await new Promise((resolve) => out.end(resolve));

console.log(`\nwrote: ${outputCsv}`);
console.log(`  spotify rows in:  ${rowsIn}`);
console.log(`  csv rows out:     ${rowsOut}`);
if (Number.isFinite(earliest)) {
  console.log(
    `  date range:       ${new Date(earliest).toISOString().slice(0, 10)} → ${new Date(latest).toISOString().slice(0, 10)}`,
  );
}
