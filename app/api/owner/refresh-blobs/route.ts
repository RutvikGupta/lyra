import { hasAuthSession } from "@/lib/spotify";
import { fetchProfile, fetchShowcaseProfile } from "@/lib/spotify-api";
import {
  maybeRefreshOwnerRecently,
  maybeRefreshOwnerTop,
} from "../../cron/refresh-showcase/route";

// Owner-only manual trigger to (re-)bake the Blob-backed showcase
// snapshots: top artists by time range, and recently played. Mostly
// useful immediately after a deploy to populate the Blob without
// waiting for the daily cron, or to force-refresh after rotating
// SHOWCASE_REFRESH_TOKEN.
//
// Auth: same identity check as /api/showcase/library/publish — the
// signed-in visitor's Spotify id must match the showcase owner's.

export async function POST() {
  const [visitor, owner] = await Promise.all([
    fetchProfile(),
    fetchShowcaseProfile(),
  ]);
  if (!visitor) {
    const stillAuthed = await hasAuthSession();
    if (stillAuthed) {
      return Response.json(
        {
          error: "rate_limited",
          detail: "Spotify is rate-limiting your account; retry in a minute.",
        },
        { status: 503 },
      );
    }
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!owner) {
    return Response.json(
      {
        error: "showcase_not_configured",
        detail:
          "SHOWCASE_REFRESH_TOKEN is missing or invalid; cannot resolve owner.",
      },
      { status: 503 },
    );
  }
  if (visitor.id !== owner.id) {
    return Response.json(
      { error: "forbidden", detail: "Only the showcase owner can do this." },
      { status: 403 },
    );
  }

  const [top, recently] = await Promise.all([
    maybeRefreshOwnerTop(true),
    maybeRefreshOwnerRecently(true),
  ]);
  return Response.json({ top, recently });
}
