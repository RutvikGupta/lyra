// Storage layer for user-shared constellation snapshots. Each share
// lives at `shares/{id}.json` in Vercel Blob (prod) or
// `public/shares/{id}.json` locally. Same dual-mode pattern as the
// owner showcase store, separated only because keys carry user-chosen
// IDs and lifecycle is different (each share is independent, no single
// canonical key to overwrite).

import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Snapshot } from "./showcase-library";
import { SNAPSHOT_VERSION } from "./showcase-library";

const PREFIX = "shares/";
const LOCAL_DIR = join(process.cwd(), "public", "shares");

function blobConfigured(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function localPath(id: string) {
  return join(LOCAL_DIR, `${id}.json`);
}

async function readFromLocal(id: string): Promise<Snapshot | null> {
  try {
    const raw = await readFile(localPath(id), "utf8");
    return JSON.parse(raw) as Snapshot;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

async function readFromBlob(id: string): Promise<Snapshot | null> {
  const { list } = await import("@vercel/blob");
  const path = `${PREFIX}${id}.json`;
  const result = await list({ prefix: path, limit: 1 });
  const item = result.blobs.find((b) => b.pathname === path);
  if (!item) return null;
  const res = await fetch(item.url, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as Snapshot;
}

export async function readShare(id: string): Promise<Snapshot | null> {
  const data = blobConfigured()
    ? await readFromBlob(id)
    : await readFromLocal(id);
  if (data && data.version !== SNAPSHOT_VERSION) return null;
  return data;
}

export async function writeShare(
  id: string,
  snap: Snapshot,
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

// Listing + deletion are used only by the cron sweep that prunes old
// shares. See app/api/cron/refresh-showcase/route.ts.

export type ShareListing = { id: string; uploadedAt: number; url?: string };

async function listFromBlob(): Promise<ShareListing[]> {
  const { list } = await import("@vercel/blob");
  // Paginate in case there are >1000 shares — `list()` defaults to
  // 1000 per page; we keep going until cursor is exhausted.
  const all: ShareListing[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const b of result.blobs) {
      // pathname looks like "shares/abc123.json" — strip the prefix
      // and the .json suffix to recover the id.
      if (!b.pathname.startsWith(PREFIX)) continue;
      const tail = b.pathname.slice(PREFIX.length);
      if (!tail.endsWith(".json")) continue;
      const id = tail.slice(0, -".json".length);
      const uploadedAt =
        b.uploadedAt instanceof Date
          ? b.uploadedAt.getTime()
          : new Date(b.uploadedAt).getTime();
      all.push({ id, uploadedAt, url: b.url });
    }
    cursor = result.cursor;
  } while (cursor);
  return all;
}

async function listFromLocal(): Promise<ShareListing[]> {
  try {
    const files = await readdir(LOCAL_DIR);
    const out: ShareListing[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const path = join(LOCAL_DIR, f);
      const s = await stat(path);
      out.push({ id: f.slice(0, -".json".length), uploadedAt: s.mtimeMs });
    }
    return out;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

export async function listShares(): Promise<ShareListing[]> {
  return blobConfigured() ? listFromBlob() : listFromLocal();
}

export async function deleteShare(
  entry: ShareListing,
): Promise<void> {
  if (blobConfigured()) {
    const { del } = await import("@vercel/blob");
    // del() accepts the public URL or the pathname. Prefer the URL we
    // already have from listing — most resilient.
    const target = entry.url ?? `${PREFIX}${entry.id}.json`;
    await del(target);
    return;
  }
  await unlink(localPath(entry.id));
}
