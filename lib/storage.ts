import { del, get, set } from "idb-keyval";
import type { ParsedHistory, StoredHistory } from "./types";

const KEY = "spotify_history_v1";

export async function saveHistory(h: ParsedHistory): Promise<void> {
  const stored: StoredHistory = {
    source: h.source,
    plays: h.plays,
    tracks: Array.from(h.tracks.values()),
    artists: Array.from(h.artists.values()),
    totalPlays: h.totalPlays,
    totalMsPlayed: h.totalMsPlayed,
    earliest: h.earliest,
    latest: h.latest,
    parsedAt: h.parsedAt,
  };
  await set(KEY, stored);
}

export async function loadHistory(): Promise<StoredHistory | undefined> {
  return await get<StoredHistory>(KEY);
}

export async function clearHistory(): Promise<void> {
  await del(KEY);
}
