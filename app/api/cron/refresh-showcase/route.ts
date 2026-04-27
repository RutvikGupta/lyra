import {
  readOwnerRecently,
  REFRESH_AFTER_MS as RECENTLY_REFRESH_AFTER_MS,
  refreshOwnerRecentlyFromSpotify,
} from "@/lib/owner-recently-store";
import {
  OWNER_TOP_VERSION,
  readOwnerTop,
  REFRESH_AFTER_MS,
  writeOwnerTop,
} from "@/lib/owner-top-store";
import { deleteShare, listShares } from "@/lib/share-store";
import type { ArtistApiItem } from "@/lib/showcase-library";
import {
  enrichArtists,
  fetchShowcaseTopArtists,
  type TimeRange,
} from "@/lib/spotify-api";
import {
  invalidateShowcaseCache,
  resetShowcaseLatch,
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
  const sharesSweep = await sweepOldShares();

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
    sharesSweep,
    results: results.map((r) =>
      r.status === "fulfilled" ? r.value : { error: String(r.reason) },
    ),
  });
}

const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function sweepOldShares(): Promise<{
  scanned: number;
  deleted: number;
  failed: number;
}> {
  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  try {
    const shares = await listShares();
    scanned = shares.length;
    const cutoff = Date.now() - SHARE_TTL_MS;
    const expired = shares.filter((s) => s.uploadedAt < cutoff);
    // Delete sequentially to avoid Blob API rate-limits on the cron run.
    // Volume is low enough (a few deletions per day at most) that
    // serializing is fine.
    for (const entry of expired) {
      try {
        await deleteShare(entry);
        deleted++;
      } catch {
        failed++;
      }
    }
  } catch {
    // Listing itself failed (Blob outage, etc.) — surface failed:1 so
    // the cron response makes the issue visible without throwing.
    failed = 1;
  }
  return { scanned, deleted, failed };
}

const RANGES: TimeRange[] = ["short_term", "medium_term", "long_term"];

export async function maybeRefreshOwnerTop(force = false): Promise<{
  status: "skipped" | "refreshed" | "failed";
  refreshedAt?: number;
  reason?: string;
}> {
  const existing = await readOwnerTop();
  const now = Date.now();
  if (!force && existing && now - existing.refreshedAt < REFRESH_AFTER_MS) {
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

export async function maybeRefreshOwnerRecently(force = false): Promise<{
  status: "skipped" | "refreshed" | "failed";
  refreshedAt?: number;
  reason?: string;
}> {
  const existing = await readOwnerRecently();
  const now = Date.now();
  if (
    !force &&
    existing &&
    now - existing.refreshedAt < RECENTLY_REFRESH_AFTER_MS
  ) {
    return { status: "skipped", refreshedAt: existing.refreshedAt };
  }
  const ok = await refreshOwnerRecentlyFromSpotify();
  if (!ok) {
    return { status: "failed", reason: "spotify-fetch-failed-or-empty" };
  }
  const after = await readOwnerRecently();
  return { status: "refreshed", refreshedAt: after?.refreshedAt };
}
