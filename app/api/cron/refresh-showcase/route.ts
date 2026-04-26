import { invalidateShowcaseCache } from "@/lib/spotify-showcase";

// Vercel cron entry point. Vercel injects an `Authorization: Bearer <CRON_SECRET>`
// header so we can verify it isn't a public hit.
//
// On each tick:
//   1. Invalidate the in-memory cache so the next refetch is fresh.
//   2. Hit each showcase endpoint to warm the cache (so a real visitor
//      hitting the page doesn't pay the cold-start latency).
//
// The `cron job` itself does not need to do work beyond this — visitors
// will pull from the warm in-memory cache, with TTLs (15s / 5min / 1h)
// controlling how stale the data is between cron ticks.

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${expected}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

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
