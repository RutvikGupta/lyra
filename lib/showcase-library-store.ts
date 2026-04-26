// Storage layer for the library showcase snapshot. Picks between Vercel
// Blob (when BLOB_READ_WRITE_TOKEN is set, i.e. prod) and a local file in
// public/ (everything else — zero-config dev).
//
// Both paths produce a single named blob/file. `read()` returns null when
// nothing has been published yet; `write()` overwrites whatever was
// there. No history / multi-version support — keeping it simple.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LibrarySnapshot } from "./showcase-library";
import { SNAPSHOT_VERSION } from "./showcase-library";

const PATHNAME = "showcase-library.json";
const LOCAL_PATH = join(process.cwd(), "public", PATHNAME);

function blobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function readFromLocal(): Promise<LibrarySnapshot | null> {
  try {
    const raw = await readFile(LOCAL_PATH, "utf8");
    return JSON.parse(raw) as LibrarySnapshot;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function readFromBlob(): Promise<LibrarySnapshot | null> {
  const { list } = await import("@vercel/blob");
  const result = await list({ prefix: PATHNAME, limit: 1 });
  const item = result.blobs.find((b) => b.pathname === PATHNAME);
  if (!item) return null;
  // The blob is public, so a plain fetch works. Cache-busting on the URL
  // — list returns a versioned URL — so we don't re-serve a stale copy
  // after a republish.
  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as LibrarySnapshot;
}

let cached: { data: LibrarySnapshot; expiresAt: number } | null = null;
const READ_TTL_MS = 60_000;

export async function readSnapshot(): Promise<LibrarySnapshot | null> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  const data = blobConfigured()
    ? await readFromBlob()
    : await readFromLocal();
  if (data && data.version !== SNAPSHOT_VERSION) {
    return null; // version mismatch — treat as not present
  }
  if (data) {
    cached = { data, expiresAt: now + READ_TTL_MS };
  } else {
    cached = null;
  }
  return data;
}

export async function writeSnapshot(snap: LibrarySnapshot): Promise<{
  mode: "blob" | "local";
  url?: string;
  path?: string;
}> {
  const json = JSON.stringify(snap, null, 0);
  cached = null; // invalidate read cache so next reader sees fresh data

  if (blobConfigured()) {
    const { put } = await import("@vercel/blob");
    const result = await put(PATHNAME, json, {
      access: "public",
      addRandomSuffix: false, // overwrite the same key each time
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    return { mode: "blob", url: result.url };
  }

  await writeFile(LOCAL_PATH, json, "utf8");
  return { mode: "local", path: LOCAL_PATH };
}

export function snapshotStorageMode(): "blob" | "local" {
  return blobConfigured() ? "blob" : "local";
}
