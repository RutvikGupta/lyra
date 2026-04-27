import {
  OWNER_RECENTLY_VERSION,
  readOwnerRecently,
  REFRESH_AFTER_MS as RECENTLY_REFRESH_AFTER_MS,
  writeOwnerRecently,
  type OwnerRecentlyItem,
} from "@/lib/owner-recently-store";
import {
  OWNER_TOP_VERSION,
  readOwnerTop,
  REFRESH_AFTER_MS,
  writeOwnerTop,
} from "@/lib/owner-top-store";
import type { ArtistApiItem } from "@/lib/showcase-library";
import {
  enrichArtists,
  fetchShowcaseTopArtists,
  type TimeRange,
} from "@/lib/spotify-api";
import {
  invalidateShowcaseCache,
  resetShowcaseLatch,
  spotifyShowcaseFetch,
} from "@/lib/spotify-showcase";

// Vercel cron entry point. Vercel injects an `Authorization: Bearer <CRON_SECRET>`
// header so we can verify it isn't a public hit.
//
// On each tick:
//   1. Reset the "env token is dead" latch + drop the rotated in-memory
//      refresh token so we re-read SHOWCASE_REFRESH_TOKEN from env. This
//      is the self-heal: if Spotify rotated the token (or the user has
//      since updated the env var), the next call rebuilds state cleanly
//      without needing a redeploy.
//   2. Invalidate the in-memory response cache so the next refetch is
//      fresh.
//   3. Hit each showcase endpoint to warm the cache (so a real visitor
//      hitting the page doesn't pay the cold-start latency).

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  resetShowcaseLatch();
  invalidateShowcaseCache();

  // Weekly refresh of the Blob-backed owner-top snapshot. The cron
  // fires daily (Hobby tier limit), but we only re-fetch when the last
  // bake is older than REFRESH_AFTER_MS. Top artists barely move week-
  // to-week, and each refresh costs 3 Spotify API calls (one per time
  // range) plus enrichment — paying that daily would burn rate-limit
  // budget for no perceptible UX gain.
  const ownerTopRefresh = await maybeRefreshOwnerTop();
  const ownerRecentlyRefresh = await maybeRefreshOwnerRecently();

  const origin = new URL(req.url).origin;
  const paths = ["/api/showcase/profile"];

  const results = await Promise.allSettled(
    paths.map((p) =>
      fetch(`${origin}${p}`, { cache: "no-store" }).then((r) => ({
        path: p,
        ok: r.ok,
        status: r.status,
      })),
    ),
  );

  return Response.json({
    refreshedAt: new Date().toISOString(),
    ownerTop: ownerTopRefresh,
    ownerRecently: ownerRecentlyRefresh,
    results: results.map((r) =>
      r.status === "fulfilled" ? r.value : { error: String(r.reason) },
    ),
  });
}

const RANGES: TimeRange[] = ["short_term", "medium_term", "long_term"];

async function maybeRefreshOwnerTop(): Promise<{
  status: "skipped" | "refreshed" | "failed";
  refreshedAt?: number;
  reason?: string;
}> {
  const existing = await readOwnerTop();
  const now = Date.now();
  if (existing && now - existing.refreshedAt < REFRESH_AFTER_MS) {
    return { status: "skipped", refreshedAt: existing.refreshedAt };
  }
  try {
    // Fetch all three ranges in parallel. Each call is server-side
    // through the showcase token, with the existing rate-limit cooldown
    // protections in spotify-showcase.ts.
    const fetched = await Promise.all(
      RANGES.map(async (range): Promise<[TimeRange, ArtistApiItem[]]> => {
        const data = await fetchShowcaseTopArtists(range, 50);
        if (!data) return [range, []];
        const enriched = await enrichArtists(data.items);
        const items: ArtistApiItem[] = enriched.map((a, rank) => ({
          id: a.id,
          rank: rank + 1,
          name: a.name,
          genres: Array.isArray(a.genres) ? a.genres : [],
          image: a.images?.[0]?.url ?? null,
          popularity: a.popularity ?? 0,
          listeners: a.lastfmListeners ?? 0,
          playcount: a.lastfmPlaycount ?? 0,
          uri: a.uri,
        }));
        return [range, items];
      }),
    );
    const artists: Record<TimeRange, ArtistApiItem[]> = {
      short_term: [],
      medium_term: [],
      long_term: [],
    };
    for (const [range, items] of fetched) {
      artists[range] = items;
    }
    // If every range came back empty, the showcase token is dead or
    // rate-limited — don't overwrite a good prior snapshot with empties.
    const allEmpty = RANGES.every((r) => artists[r].length === 0);
    if (allEmpty) {
      return { status: "failed", reason: "all-empty" };
    }
    const refreshedAt = Date.now();
    await writeOwnerTop({
      version: OWNER_TOP_VERSION,
      refreshedAt,
      artists,
    });
    return { status: "refreshed", refreshedAt };
  } catch (err) {
    return { status: "failed", reason: String(err) };
  }
}

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

async function maybeRefreshOwnerRecently(): Promise<{
  status: "skipped" | "refreshed" | "failed";
  refreshedAt?: number;
  reason?: string;
}> {
  const existing = await readOwnerRecently();
  const now = Date.now();
  if (existing && now - existing.refreshedAt < RECENTLY_REFRESH_AFTER_MS) {
    return { status: "skipped", refreshedAt: existing.refreshedAt };
  }
  try {
    const res = await spotifyShowcaseFetch(
      "/me/player/recently-played?limit=20",
    );
    if (!res || !res.ok) {
      return { status: "failed", reason: `status=${res?.status ?? "null"}` };
    }
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
    if (items.length === 0) {
      // Don't overwrite a good prior snapshot with empties (token dead /
      // rate-limited / Spotify hiccup).
      return { status: "failed", reason: "empty" };
    }
    const refreshedAt = Date.now();
    await writeOwnerRecently({
      version: OWNER_RECENTLY_VERSION,
      refreshedAt,
      items,
    });
    return { status: "refreshed", refreshedAt };
  } catch (err) {
    return { status: "failed", reason: String(err) };
  }
}
