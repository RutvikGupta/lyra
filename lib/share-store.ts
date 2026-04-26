// Storage layer for user-shared constellation snapshots. Each share
// lives at `shares/{id}.json` in Vercel Blob (prod) or
// `public/shares/{id}.json` locally. Same dual-mode pattern as the
// owner showcase store, separated only because keys carry user-chosen
// IDs and lifecycle is different (each share is independent, no single
// canonical key to overwrite).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { LibrarySnapshot } from "./showcase-library";
import { SNAPSHOT_VERSION } from "./showcase-library";

const PREFIX = "shares/";
const LOCAL_DIR = join(process.cwd(), "public", "shares");

function blobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function localPath(id: string) {
  return join(LOCAL_DIR, `${id}.json`);
}

async function readFromLocal(id: string): Promise<LibrarySnapshot | null> {
  try {
    const raw = await readFile(localPath(id), "utf8");
    return JSON.parse(raw) as LibrarySnapshot;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function readFromBlob(id: string): Promise<LibrarySnapshot | null> {
  const { list } = await import("@vercel/blob");
  const path = `${PREFIX}${id}.json`;
  const result = await list({ prefix: path, limit: 1 });
  const item = result.blobs.find((b) => b.pathname === path);
  if (!item) return null;
  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as LibrarySnapshot;
}

export async function readShare(id: string): Promise<LibrarySnapshot | null> {
  const data = blobConfigured()
    ? await readFromBlob(id)
    : await readFromLocal(id);
  if (data && data.version !== SNAPSHOT_VERSION) return null;
  return data;
}

export async function writeShare(
  id: string,
  snap: LibrarySnapshot,
): Promise<{ mode: "blob" | "local"; url?: string; path?: string }> {
  const json = JSON.stringify(snap, null, 0);

  if (blobConfigured()) {
    const { put } = await import("@vercel/blob");
    const result = await put(`${PREFIX}${id}.json`, json, {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
      cacheControlMaxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return { mode: "blob", url: result.url };
  }

  const path = localPath(id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json, "utf8");
  return { mode: "local", path };
}
