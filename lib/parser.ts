import { unzip } from "fflate";
import type { Artist, ParsedHistory, Play, Track } from "./types";

const MIN_MS_PLAYED = 30_000;

type ExtendedRow = {
  ts?: string;
  ms_played?: number;
  master_metadata_track_name?: string | null;
  master_metadata_album_artist_name?: string | null;
  master_metadata_album_album_name?: string | null;
  spotify_track_uri?: string | null;
  reason_start?: string | null;
  reason_end?: string | null;
  shuffle?: boolean | null;
  skipped?: boolean | null;
};

type AccountRow = {
  endTime?: string;
  msPlayed?: number;
  trackName?: string | null;
  artistName?: string | null;
};

export type ParseProgress = (msg: string) => void;

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function parseFiles(
  files: File[],
  onProgress: ParseProgress = () => {},
): Promise<ParsedHistory> {
  onProgress("Reading files…");
  const jsonContents: { name: string; text: string }[] = [];

  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      onProgress(`Unzipping ${file.name}…`);
      const buf = new Uint8Array(await file.arrayBuffer());
      const entries = await unzipAsync(buf);
      for (const [path, data] of Object.entries(entries)) {
        if (isStreamingHistoryFile(path)) {
          jsonContents.push({
            name: path,
            text: new TextDecoder().decode(data),
          });
        }
      }
    } else if (file.name.toLowerCase().endsWith(".json")) {
      jsonContents.push({ name: file.name, text: await file.text() });
    }
  }

  if (jsonContents.length === 0) {
    throw new Error(
      "No streaming history JSON files found. Drop the ZIP from Spotify, or the StreamingHistory*.json / Streaming_History_Audio_*.json files directly.",
    );
  }

  await yieldToUi();
  onProgress(`Parsing ${jsonContents.length} file(s)…`);

  const plays: Play[] = [];
  let foundExtended = false;
  let foundAccount = false;

  for (const { name, text } of jsonContents) {
    onProgress(`Parsing ${name}…`);
    let arr: unknown;
    try {
      arr = JSON.parse(text);
    } catch {
      continue;
    }
    if (!Array.isArray(arr)) continue;

    for (const entry of arr as Array<ExtendedRow & AccountRow>) {
      if (
        entry.master_metadata_track_name !== undefined ||
        entry.spotify_track_uri !== undefined ||
        entry.ts !== undefined
      ) {
        if (!entry.master_metadata_track_name) continue;
        const ts = entry.ts ? Date.parse(entry.ts) : NaN;
        if (!Number.isFinite(ts)) continue;
        foundExtended = true;
        plays.push({
          ts,
          msPlayed: entry.ms_played ?? 0,
          trackName: entry.master_metadata_track_name,
          artistName: entry.master_metadata_album_artist_name ?? "Unknown",
          albumName: entry.master_metadata_album_album_name ?? undefined,
          trackUri: entry.spotify_track_uri ?? undefined,
          reasonStart: entry.reason_start ?? undefined,
          reasonEnd: entry.reason_end ?? undefined,
          shuffle: entry.shuffle ?? undefined,
          skipped: entry.skipped ?? undefined,
        });
      } else if (entry.trackName !== undefined) {
        if (!entry.trackName) continue;
        const ts = entry.endTime ? Date.parse(entry.endTime) : NaN;
        if (!Number.isFinite(ts)) continue;
        foundAccount = true;
        plays.push({
          ts,
          msPlayed: entry.msPlayed ?? 0,
          trackName: entry.trackName,
          artistName: entry.artistName ?? "Unknown",
        });
      }
    }
    await yieldToUi();
  }

  onProgress("Aggregating…");

  const realPlays = plays.filter((p) => p.msPlayed >= MIN_MS_PLAYED);

  const tracks = new Map<string, Track>();
  const artists = new Map<string, Artist>();
  let earliest = Infinity;
  let latest = -Infinity;
  let totalMsPlayed = 0;

  for (const p of realPlays) {
    const trackKey =
      p.trackUri ?? `name:${p.trackName.toLowerCase()}::${p.artistName.toLowerCase()}`;
    const t = tracks.get(trackKey);
    if (t) {
      t.playCount++;
      t.totalMsPlayed += p.msPlayed;
      if (p.ts < t.firstPlayed) t.firstPlayed = p.ts;
      if (p.ts > t.lastPlayed) t.lastPlayed = p.ts;
    } else {
      tracks.set(trackKey, {
        key: trackKey,
        uri: p.trackUri,
        name: p.trackName,
        artistName: p.artistName,
        albumName: p.albumName,
        playCount: 1,
        totalMsPlayed: p.msPlayed,
        firstPlayed: p.ts,
        lastPlayed: p.ts,
        hasUri: !!p.trackUri,
      });
    }

    const artistKey = p.artistName.toLowerCase();
    const a = artists.get(artistKey);
    if (a) {
      a.playCount++;
      a.totalMsPlayed += p.msPlayed;
    } else {
      artists.set(artistKey, {
        key: artistKey,
        name: p.artistName,
        trackCount: 0,
        playCount: 1,
        totalMsPlayed: p.msPlayed,
      });
    }

    if (p.ts < earliest) earliest = p.ts;
    if (p.ts > latest) latest = p.ts;
    totalMsPlayed += p.msPlayed;
  }

  for (const t of tracks.values()) {
    const a = artists.get(t.artistName.toLowerCase());
    if (a) a.trackCount++;
  }

  return {
    source:
      foundExtended && foundAccount
        ? "mixed"
        : foundExtended
          ? "extended"
          : "account",
    plays: realPlays,
    tracks,
    artists,
    totalPlays: realPlays.length,
    totalMsPlayed,
    earliest: Number.isFinite(earliest) ? earliest : 0,
    latest: Number.isFinite(latest) ? latest : 0,
    parsedAt: Date.now(),
  };
}

function isStreamingHistoryFile(path: string): boolean {
  const name = path.split("/").pop() ?? "";
  if (name.startsWith(".") || name.startsWith("__MACOSX")) return false;
  return /^Streaming_?History.*\.json$/i.test(name);
}

function unzipAsync(buf: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(buf, (err, data) => (err ? reject(err) : resolve(data)));
  });
}
