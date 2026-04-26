import { fetchProfile, fetchShowcaseProfile } from "@/lib/spotify-api";
import type { LibrarySnapshot } from "@/lib/showcase-library";
import { SNAPSHOT_VERSION } from "@/lib/showcase-library";
import { writeSnapshot } from "@/lib/showcase-library-store";

// Owner-only POST that publishes a baked LibrarySnapshot. The store
// layer routes to Vercel Blob (when BLOB_READ_WRITE_TOKEN is set) or to
// public/showcase-library.json for zero-config local dev.
//
// Owner identity = whoever's refresh token is in SHOWCASE_REFRESH_TOKEN
// (i.e. the account that controls the showcase). We compare the
// visitor's Spotify user id against the showcase owner's id. This means
// no extra env var is needed and the gate stays in sync with whoever
// owns the showcase.

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
  const [visitor, owner] = await Promise.all([
    fetchProfile(),
    fetchShowcaseProfile(),
  ]);
  if (!visitor) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!owner) {
    return Response.json(
      {
        error: "showcase_not_configured",
        detail:
          "SHOWCASE_REFRESH_TOKEN is missing or invalid; cannot resolve owner identity.",
      },
      { status: 503 },
    );
  }
  if (visitor.id !== owner.id) {
    return Response.json(
      {
        error: "forbidden",
        detail: "Only the showcase owner can publish snapshots.",
      },
      { status: 403 },
    );
  }

  let snapshot: unknown;
  try {
    snapshot = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isLibrarySnapshot(snapshot)) {
    return Response.json(
      { error: "snapshot_shape_invalid" },
      { status: 400 },
    );
  }

  try {
    const result = await writeSnapshot(snapshot);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json(
      { error: "write_failed", detail: String(err) },
      { status: 500 },
    );
  }
}
