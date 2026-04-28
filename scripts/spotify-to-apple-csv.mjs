// Convert a Spotify "Extended streaming history" ZIP into a CSV
// shaped like a real "Apple Music Play Activity.csv" export.
// Schema verified against the test fixtures in
// github.com/nerveband/Apple-Music-Play-History-Converter (2025).
//
// Field mapping:
//   Spotify ts                                 → Event End Timestamp
//   master_metadata_track_name                 → Song Name
//   master_metadata_album_artist_name          → Container Artist Name
//   master_metadata_album_album_name           → Album Name + Container Album Name
//   ms_played                                  → Play Duration Milliseconds
//                                                + End Position In Milliseconds
//                                                + Media Duration In Milliseconds
//   reason_end === "trackdone"                 → End Reason Type=NATURAL_END_OF_TRACK
//
// Apple's real Play Activity export has 100+ columns; we only
// populate the ones our parser reads. Empty placeholder columns are
// included so the file looks structurally similar to a real export.
//
// Usage:
//   node scripts/spotify-to-apple-csv.mjs [input.zip] [output.csv]
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

// Match a real Play Activity header. Order matters because Apple
// exports keep a stable column order; we replicate that even though
// our parser is column-name-indexed (so order doesn't strictly
// matter for parsing).
const COLUMNS = [
  "Album Name",
  "Apple ID Number",
  "Apple Music Subscription",
  "Auto Play",
  "Build Version",
  "Bundle Version",
  "Camera Option",
  "Client Build Version",
  "Client Device Name",
  "Client IP Address",
  "Client Platform",
  "Container Album Name",
  "Container Artist Name",
  "Container Global Playlist ID",
  "Container ID",
  "Container iTunes Playlist ID",
  "Container Library ID",
  "Container Name",
  "Container Origin Type",
  "Container Personalized ID",
  "Container Playlist ID",
  "Container Radio Station ID",
  "Container Radio Station Version",
  "Container Season ID",
  "Container Type",
  "Contingency",
  "Device App Name",
  "Device App Version",
  "Device Identifier",
  "Device OS Name",
  "Device OS Version",
  "Device Type",
  "Display Count",
  "Display Language",
  "Display Type",
  "End Position In Milliseconds",
  "End Reason Type",
  "Evaluation Variant",
  "Event End Timestamp",
  "Event ID",
  "Event Post Date Time",
  "Event Reason Hint Type",
  "Event Received Timestamp",
  "Event Start Timestamp",
  "Event Timestamp",
  "Event Type",
  "Feature Name",
  "Grouping",
  "House ID",
  "IP City",
  "IP Country Code",
  "IP Latitude",
  "IP Longitude",
  "IP Network",
  "IP Network Type",
  "IP Region Code",
  "Is CMA Station",
  "Is Collaborative",
  "Is Delegated",
  "Is Heatseeker Station",
  "Is Heavy Rotation Station",
  "Is Royalty",
  "Is Vocal Attenuation",
  "Item Type",
  "Key Request",
  "Lease Limit",
  "Legacy Container Name",
  "Legacy Playback ID",
  "Local Radio Station ID",
  "Local Radio Station TuneIn ID",
  "Matched Content",
  "Media Bundle App Name",
  "Media Bundle Type",
  "Media Duration In Milliseconds",
  "Media Type",
  "Metrics Client ID",
  "Milliseconds Since Play",
  "Offline",
  "Ownership Type",
  "Personalized Name",
  "Play Duration Milliseconds",
  "Provided Audio Bit Depth",
  "Provided Audio Channel",
  "Provided Audio Sample Rate",
  "Provided Bit Rate",
  "Provided Codec",
  "Provided Playback Format",
  "Provider ID",
  "Radio Format",
  "Radio Seed ID",
  "Radio Station Country",
  "Radio Station ID",
  "Radio Station Position",
  "Radio Type",
  "Radio User ID",
  "Referral ID",
  "Repeat Play",
  "Report Type",
  "Session Is Shared",
  "Shared Activity Devices-Current",
  "Shared Activity Devices-Max",
  "Shuffle Play",
  "Siri Request",
  "Song Name",
  "Source Model",
  "Source Radio Name",
  "Source Radio Type",
  "Source Type",
  "Start Position In Milliseconds",
  "Store Front Name",
  "Subscribed State",
  "Subscription Discovery Mode",
  "Use Listening History",
  "User’s Audio Quality",
  "User’s Playback Format",
  "UTC Offset In Seconds",
  "Vocal Attenuation Duration",
  "Vocal Attenuation Model ID",
];

function csvField(s) {
  const str = String(s ?? "");
  if (str === "") return "";
  // Always quote when there's content; matches Apple's habit and is
  // safe regardless of embedded commas.
  return `"${str.replace(/"/g, '""')}"`;
}

function emit(values) {
  // values is a partial map keyed by column name. Build a row aligned
  // with COLUMNS, leaving unmapped columns blank.
  const cells = COLUMNS.map((col) => {
    const v = values[col];
    if (v === undefined || v === null) return "";
    return csvField(v);
  });
  return cells.join(",") + "\n";
}

mkdirSync(dirname(outputCsv), { recursive: true });
const out = createWriteStream(outputCsv, { encoding: "utf8" });
// Header — emitted unquoted to match Apple's actual exports (their
// header row is plain commas, no quoting).
out.write(COLUMNS.join(",") + "\n");

let rowsIn = 0;
let rowsOut = 0;
let earliest = Infinity;
let latest = -Infinity;
let missingArtist = 0;

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

    const isExtended =
      entry.master_metadata_track_name !== undefined ||
      entry.spotify_track_uri !== undefined ||
      entry.ts !== undefined;
    let trackName, artistName, albumName, ts, msPlayed, completed;

    if (isExtended) {
      if (!entry.master_metadata_track_name) continue;
      trackName = entry.master_metadata_track_name;
      artistName = entry.master_metadata_album_artist_name ?? "";
      albumName = entry.master_metadata_album_album_name ?? "";
      ts = entry.ts;
      msPlayed = Number(entry.ms_played) || 0;
      completed = entry.reason_end === "trackdone";
    } else {
      if (!entry.trackName) continue;
      trackName = entry.trackName;
      artistName = entry.artistName ?? "";
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
    if (!artistName) missingArtist++;

    const tsIso = new Date(tsMs).toISOString();

    out.write(
      emit({
        "Album Name": albumName,
        "Container Album Name": albumName,
        "Container Artist Name": artistName,
        "Container Type": albumName ? "ALBUM" : "",
        "Apple ID Number": "0",
        "Apple Music Subscription": "TRUE",
        "Client Platform": "FUSE",
        "End Position In Milliseconds": String(msPlayed),
        "End Reason Type": completed
          ? "NATURAL_END_OF_TRACK"
          : "PLAYBACK_MANUALLY_PAUSED",
        "Event End Timestamp": tsIso,
        "Event Reason Hint Type": "NOT_SPECIFIED",
        "Event Received Timestamp": tsIso,
        "Event Start Timestamp": tsIso,
        "Event Type": "PLAY_END",
        "Feature Name": "library",
        "Item Type": "ITUNES_STORE_CONTENT",
        "Media Bundle Type": "BUNDLE_NOT_SPECIFIED",
        "Media Duration In Milliseconds": String(msPlayed),
        "Media Type": "AUDIO",
        "Play Duration Milliseconds": String(msPlayed),
        "Source Type": "ORIGINATING_DEVICE",
        "Start Position In Milliseconds": "0",
        "Store Front Name": "United States",
        "Song Name": trackName,
        "UTC Offset In Seconds": "0",
      }),
    );
    rowsOut++;
  }
}

await new Promise((resolve) => out.end(resolve));

console.log(`\nwrote: ${outputCsv}`);
console.log(`  spotify rows in:  ${rowsIn}`);
console.log(`  csv rows out:     ${rowsOut}`);
console.log(`  rows w/o artist:  ${missingArtist} (will read as 'Unknown')`);
if (Number.isFinite(earliest)) {
  console.log(
    `  date range:       ${new Date(earliest).toISOString().slice(0, 10)} → ${new Date(latest).toISOString().slice(0, 10)}`,
  );
}
