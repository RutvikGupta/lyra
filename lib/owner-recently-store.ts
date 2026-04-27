// Persistent (Blob-backed) cache of the owner's recently-played feed.
// Refreshed daily by the cron AND opportunistically by reads via
// readOwnerRecentlyFresh() — visitor traffic reads from the blob
// instead of hitting Spotify directly, but a stale-while-revalidate
// path keeps the data fresh whenever someone's actually looking at
// the page.
//
// Storage parallels lib/owner-top-store.ts: Vercel Blob in prod
// (BLOB_READ_WRITE_TOKEN), local file in dev. Read-cached in-process
// for ~5 min so visitor pages don't re-fetch the blob on every render.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spotifyShowcaseFetch } from "./spotify-showcase";

export const OWNER_RECENTLY_VERSION = 1;

export type OwnerRecentlyItem = {
  playedAt: string;
  track: {
    name: string;
    uri: string;
    artists: string[];
    image?: string | null;
  };
};

export type OwnerRecentlyBlob = {
  version: number;
  refreshedAt: number;
  items: OwnerRecentlyItem[];
};

const PATHNAME = "owner-recently.json";
const LOCAL_PATH = join(process.cwd(), "public", PATHNAME);
const READ_TTL_MS = 5 * 60_000;
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000; // 1 day

function blobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function readFromLocal(): Promise<OwnerRecentlyBlob | null> {
  try {
    const raw = await readFile(LOCAL_PATH, "utf8");
    return JSON.parse(raw) as OwnerRecentlyBlob;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function readFromBlob(): Promise<OwnerRecentlyBlob | null> {
  const { list } = await import("@vercel/blob");
  const result = await list({ prefix: PATHNAME, limit: 1 });
  const item = result.blobs.find((b) => b.pathname === PATHNAME);
  if (!item) return null;
  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as OwnerRecentlyBlob;
}

let cached: { data: OwnerRecentlyBlob; expiresAt: number } | null = null;

export async function readOwnerRecently(): Promise<OwnerRecentlyBlob | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;
  const data = blobConfigured()
    ? await readFromBlob()
    : await readFromLocal();
  if (data && data.version !== OWNER_RECENTLY_VERSION) {
    return null;
  }
  if (data) {
    cached = { data, expiresAt: now + READ_TTL_MS };
  } else {
    cached = null;
  }
  return data;
}

export async function writeOwnerRecently(snap: OwnerRecentlyBlob): Promise<{
  mode: "blob" | "local";
  url?: string;
  path?: string;
}> {
  const json = JSON.stringify(snap, null, 0);
  cached = null;
  if (blobConfigured()) {
    const { put } = await import("@vercel/blob");
    const result = await put(PATHNAME, json, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    return { mode: "blob", url: result.url };
  }
  await writeFile(LOCAL_PATH, json, "utf8");
  return { mode: "local", path: LOCAL_PATH };
}

// Default stale-while-revalidate window for visitor reads. Five
// minutes is short enough that the showcase recently-played list
// visibly updates while a visitor is on the page, and long enough
// that bursty traffic doesn't stampede Spotify (the inflight promise
// below dedupes concurrent refreshes regardless).
export const SWR_STALE_AFTER_MS = 5 * 60 * 1000;

// Module-scope inflight promise so concurrent visitors who all see a
// stale Blob share a single Spotify refresh call. Cleared in the
// finally block.
let inflightRefresh: Promise<void> | null = null;

type SpotifyRecentlyResponse = {
  items?: {
    played_at: string;
    track: {
      name: string;
      uri: string;
      artists?: { name: string }[];
      album?: { images?: { url: string }[] };
    };
  }[];
};

// Pull the latest 20 plays from Spotify (using the showcase token)
// and write them to Blob. Returns true on success. Used by the cron
// for guaranteed-daily freshness AND by readOwnerRecentlyFresh below
// for opportunistic on-visit refresh.
export async function refreshOwnerRecentlyFromSpotify(): Promise<boolean> {
  try {
    const res = await spotifyShowcaseFetch(
      "/me/player/recently-played?limit=20",
    );
    if (!res || !res.ok) return false;
    const data = (await res.json()) as SpotifyRecentlyResponse;
    const items: OwnerRecentlyItem[] = (data.items ?? []).map((item) => ({
      playedAt: item.played_at,
      track: {
        name: item.track.name,
        uri: item.track.uri,
        artists: (item.track.artists ?? []).map((a) => a.name),
        image: item.track.album?.images?.[0]?.url ?? null,
      },
    }));
    if (items.length === 0) return false; // never overwrite with empties
    await writeOwnerRecently({
      version: OWNER_RECENTLY_VERSION,
      refreshedAt: Date.now(),
      items,
    });
    return true;
  } catch {
    return false;
  }
}

// Returns the latest snapshot, refreshing it from Spotify if it's
// older than maxAgeMs. Concurrent callers share one inflight refresh.
// Best-effort — if the refresh fails (rate-limit, token dead), we
// return whatever's currently in Blob.
export async function readOwnerRecentlyFresh(
  maxAgeMs: number = SWR_STALE_AFTER_MS,
): Promise<OwnerRecentlyBlob | null> {
  const existing = await readOwnerRecently();
  const isStale =
    !existing || Date.now() - existing.refreshedAt > maxAgeMs;
  if (!isStale) return existing;

  if (!inflightRefresh) {
    inflightRefresh = refreshOwnerRecentlyFromSpotify()
      .then(() => {})
      .finally(() => {
        inflightRefresh = null;
      });
  }
  // Wait for the refresh, but don't pin the response indefinitely if
  // Spotify is slow — fall back to the stale Blob after 2.5s.
  await Promise.race([
    inflightRefresh,
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ]);
  return readOwnerRecently();
}
