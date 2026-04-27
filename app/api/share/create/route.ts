import type { Snapshot } from "@/lib/showcase-library";
import { SNAPSHOT_VERSION } from "@/lib/showcase-library";
import { newShareId } from "@/lib/share-id";
import { writeShare } from "@/lib/share-store";

// Anyone with their own library data can publish a share. We don't gate
// on Spotify auth — the snapshot itself is what's being shared, not
// account-linked data. To prevent abuse: snapshot-size cap, random IDs
// (un-enumerable), and a per-IP rate limit (sliding-window).
//
// Lifetime: shares persist for 30 days. The daily cron at
// /api/cron/refresh-showcase sweeps and deletes anything older than
// that. If you need permanent shares, drop the sweep step.

const MAX_BYTES = 1_000_000; // 1 MB — top-200 baked snapshots run ~50KB; 20× headroom.

// Sliding-window rate limit: max N share-creates per IP per WINDOW_MS.
// Module-scope Map persists across requests on the same Fluid Compute
// instance. Multi-instance deploys could let a bad actor exceed the
// limit by load-balancing across them, but for a small site this is
// good enough — and far better than no limit.
const RATE_LIMIT_PER_IP = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ipHistory = new Map<string, number[]>();

function clientIp(req: Request): string {
  // Vercel sets x-forwarded-for; fall back to x-real-ip; otherwise
  // bucket all anonymous traffic together (the limit becomes global).
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function isOverLimit(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const history = ipHistory.get(ip) ?? [];
  // Drop entries older than the window.
  const recent = history.filter((t) => t > cutoff);
  if (recent.length >= RATE_LIMIT_PER_IP) {
    ipHistory.set(ip, recent);
    return true;
  }
  recent.push(now);
  ipHistory.set(ip, recent);
  // Opportunistic GC — keep the map from growing unbounded if the
  // process serves a long tail of unique IPs.
  if (ipHistory.size > 5000) {
    for (const [k, v] of ipHistory) {
      const filtered = v.filter((t) => t > cutoff);
      if (filtered.length === 0) ipHistory.delete(k);
      else ipHistory.set(k, filtered);
    }
  }
  return false;
}

const VALID_TIME_RANGES = new Set([
  "short_term",
  "medium_term",
  "long_term",
]);

function isSnapshot(x: unknown): x is Snapshot {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (
    o.version !== SNAPSHOT_VERSION ||
    typeof o.ownerName !== "string" ||
    typeof o.exportedAt !== "number"
  ) {
    return false;
  }
  if (o.kind === "artists") {
    return (
      typeof o.timeRange === "string" &&
      VALID_TIME_RANGES.has(o.timeRange) &&
      Array.isArray(o.items)
    );
  }
  // kind missing/"library" → require library fields
  return (
    Array.isArray(o.topTracks) &&
    Array.isArray(o.topArtists) &&
    !!o.artistGenres &&
    typeof o.artistGenres === "object"
  );
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (isOverLimit(ip)) {
    return Response.json(
      {
        error: "rate_limited",
        detail: `Max ${RATE_LIMIT_PER_IP} shares per hour from this IP. Try again later.`,
      },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
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
  if (!isSnapshot(snapshot)) {
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
