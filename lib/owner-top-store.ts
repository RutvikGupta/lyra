// Persistent (Blob-backed) cache of the owner's top artists by time
// range. The cron job refreshes this once a week — visitor traffic
// reads from the blob and never hits Spotify directly. Goals:
//
//   - Eliminate Spotify rate-limit pressure from public traffic. Every
//     unauthed visitor used to trigger a /api/showcase/top-artists call
//     that, on cache miss, hit Spotify with the showcase token. With a
//     baked snapshot, miss path stays in-process.
//   - Survive process restarts and Vercel cold starts. The previous
//     in-memory `withShowcaseCache` (1h TTL) was lost on every new
//     Fluid Compute instance and re-warmed on first visitor.
//
// Storage parallels lib/showcase-library-store.ts: Vercel Blob in prod
// (BLOB_READ_WRITE_TOKEN), local file in dev. Read-cached in-memory
// for ~5 min so visitor pages don't re-fetch the blob on every render.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtistApiItem } from "./showcase-library";

export const OWNER_TOP_VERSION = 1;

export type OwnerTopArtistsByRange = {
  short_term: ArtistApiItem[];
  medium_term: ArtistApiItem[];
  long_term: ArtistApiItem[];
};

export type OwnerTopBlob = {
  version: number;
  refreshedAt: number; // Date.now() when the cron last wrote this
  artists: OwnerTopArtistsByRange;
};

const PATHNAME = "owner-top.json";
const LOCAL_PATH = join(process.cwd(), "public", PATHNAME);
const READ_TTL_MS = 5 * 60_000;

// A baked snapshot is considered "stale enough to refresh" after a
// week. Cron decides whether to re-fetch based on this constant.
export const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function blobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function readFromLocal(): Promise<OwnerTopBlob | null> {
  try {
    const raw = await readFile(LOCAL_PATH, "utf8");
    return JSON.parse(raw) as OwnerTopBlob;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function readFromBlob(): Promise<OwnerTopBlob | null> {
  const { list } = await import("@vercel/blob");
  const result = await list({ prefix: PATHNAME, limit: 1 });
  const item = result.blobs.find((b) => b.pathname === PATHNAME);
  if (!item) return null;
  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as OwnerTopBlob;
}

let cached: { data: OwnerTopBlob; expiresAt: number } | null = null;

export async function readOwnerTop(): Promise<OwnerTopBlob | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;
  const data = blobConfigured()
    ? await readFromBlob()
    : await readFromLocal();
  if (data && data.version !== OWNER_TOP_VERSION) {
    return null; // version mismatch — treat as missing, cron will rebuild
  }
  if (data) {
    cached = { data, expiresAt: now + READ_TTL_MS };
  } else {
    cached = null;
  }
  return data;
}

export async function writeOwnerTop(snap: OwnerTopBlob): Promise<{
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

export function ownerTopStorageMode(): "blob" | "local" {
  return blobConfigured() ? "blob" : "local";
}
