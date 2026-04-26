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

  const origin = new URL(req.url).origin;
  const paths = [
    "/api/showcase/now-playing",
    "/api/showcase/top-artists?time_range=long_term",
    "/api/showcase/top-artists?time_range=medium_term",
    "/api/showcase/top-artists?time_range=short_term",
    "/api/showcase/recently-played",
    "/api/showcase/profile",
  ];

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
    results: results.map((r) =>
      r.status === "fulfilled" ? r.value : { error: String(r.reason) },
    ),
  });
}
