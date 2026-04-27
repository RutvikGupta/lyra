// Persistent (Blob-backed) cache of the owner's recently-played feed.
// Refreshed daily by the cron — visitor traffic reads from the blob
// instead of hitting Spotify directly. Recently-played changes more
// often than top-artists, so the refresh window is daily (not weekly).
//
// Storage parallels lib/owner-top-store.ts: Vercel Blob in prod
// (BLOB_READ_WRITE_TOKEN), local file in dev. Read-cached in-process
// for ~5 min so visitor pages don't re-fetch the blob on every render.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
