import type { LibrarySnapshot } from "@/lib/showcase-library";
import { SNAPSHOT_VERSION } from "@/lib/showcase-library";
import { newShareId } from "@/lib/share-id";
import { writeShare } from "@/lib/share-store";

// Anyone with their own library data can publish a share. We don't gate
// on Spotify auth — the snapshot itself is what's being shared, not
// account-linked data. To prevent abuse, we cap snapshot size and use
// random IDs (un-enumerable). Add rate limiting before exposing this
// publicly at scale.

const MAX_BYTES = 1_000_000; // 1 MB — top-200 baked snapshots run ~50KB; 20× headroom.

function isLibrarySnapshot(x: unknown): x is LibrarySnapshot {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.version === SNAPSHOT_VERSION &&
    typeof o.ownerName === "string" &&
    typeof o.exportedAt === "number" &&
    Array.isArray(o.topTracks) &&
    Array.isArray(o.topArtists) &&
    !!o.artistGenres &&
    typeof o.artistGenres === "object"
  );
}

export async function POST(req: Request) {
  const text = await req.text();
  if (text.length > MAX_BYTES) {
    return Response.json({ error: "snapshot_too_large" }, { status: 413 });
  }
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isLibrarySnapshot(snapshot)) {
    return Response.json(
      { error: "snapshot_shape_invalid" },
      { status: 400 },
    );
  }

  const id = newShareId();
  try {
    const result = await writeShare(id, snapshot);
    return Response.json({ id, mode: result.mode });
  } catch (err) {
    return Response.json(
      { error: "write_failed", detail: String(err) },
      { status: 500 },
    );
  }
}
