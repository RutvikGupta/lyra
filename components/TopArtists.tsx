"use client";

import { useEffect, useState } from "react";
import {
  readFreshCache,
  readStaleCache,
  writeCache,
} from "@/lib/client-cache";

type Item = {
  id: string;
  rank: number;
  name: string;
  image?: string | null;
  genres: string[];
  listeners?: number;
  uri?: string;
};

// Top artists barely move day-to-day. 1h TTL gives a sub-2h session
// zero /api/top calls (after the first), but a return visit later in
// the day still sees a refreshed list.
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

const RANGE_LABEL = {
  short_term: "4 weeks",
  medium_term: "6 months",
  long_term: "All time",
} as const;

type Range = keyof typeof RANGE_LABEL;

export default function TopArtists() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [authed, setAuthed] = useState(true);
  const [rateLimited, setRateLimited] = useState(false);
  const [range, setRange] = useState<Range>("long_term");

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const cacheKey = `lyra:top-artists:${range}`;

    // Fresh cache → render and skip the network entirely.
    const fresh = readFreshCache<Item[]>(cacheKey, CACHE_TTL);
    if (fresh) {
      setItems(fresh);
      return;
    }
    // Stale (or no) cache. Show stale immediately so the UI never goes
    // blank; fetch in the background to refresh.
    const stale = readStaleCache<Item[]>(cacheKey);
    setItems(stale ?? null);
    setRateLimited(false);

    // Post-OAuth, Spotify's access token can take a few seconds to be
    // accepted by /me/top/artists. The API returns 503 in that window so
    // we don't accidentally serve showcase data to a freshly signed-in
    // user. Retry on a short backoff to populate without manual refresh.
    const RETRY_DELAYS = [1000, 2000, 4000];
    let retryIdx = 0;

    async function load() {
      try {
        const r = await fetch(
          `/api/top?type=artists&time_range=${range}`,
          { cache: "no-store" },
        );
        if (r.status === 503) {
          if (!cancelled && retryIdx < RETRY_DELAYS.length) {
            retryTimer = setTimeout(load, RETRY_DELAYS[retryIdx++]);
          } else if (!cancelled && !stale) {
            setItems([]);
          }
          return;
        }
        if (!r.ok) {
          if (!cancelled && !stale) setItems([]);
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        const next = (data.items as Item[]) ?? [];
        // Rate-limited with no fresh items — same problem as a 503: a
        // brief throttle window. Keep items=null (loading state) and
        // retry on the same backoff so a tab toggle doesn't show an
        // "empty" flash. After we exhaust retries, fall back to the
        // empty + rateLimited UI so the user sees *some* explanation.
        if (data.rateLimited && next.length === 0) {
          if (!stale && retryIdx < RETRY_DELAYS.length) {
            retryTimer = setTimeout(load, RETRY_DELAYS[retryIdx++]);
            return;
          }
          setRateLimited(true);
          if (!stale) setItems([]);
          return;
        }
        setRateLimited(false);
        setItems(next);
        if (next.length > 0) writeCache(cacheKey, next);
      } catch {
        if (!cancelled && !stale) setItems([]);
      }
    }
    load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [range]);

  if (!authed) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
          Top artists
        </h2>
        <div
          className="flex gap-1 rounded-full border border-white/10 bg-black/40 p-1 text-[10px] font-semibold"
          role="tablist"
        >
          {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`cursor-pointer rounded-full px-2.5 py-1 transition-colors ${
                range === r
                  ? "bg-white text-black"
                  : "text-[var(--muted)] hover:text-white"
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {items === null ? (
        <div className="rounded-xl border border-white/[0.06] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
          Loading top artists…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
          {rateLimited
            ? "Spotify is rate-limiting your account — your top artists will appear shortly."
            : "No artists yet — Connect Spotify above to see yours."}
        </div>
      ) : (
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {items.slice(0, 10).map((a) => (
            <li key={a.id}>
              <a
                href={
                  a.uri
                    ? `https://open.spotify.com/artist/${a.id}`
                    : `https://open.spotify.com/search/${encodeURIComponent(a.name)}`
                }
                target="_blank"
                rel="noreferrer"
                className="group flex h-full flex-col gap-2 rounded-xl border border-white/[0.06] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--brand)]/30 hover:bg-[var(--surface-elevated)]"
              >
                <div className="relative aspect-square overflow-hidden rounded-lg bg-white/[0.04]">
                  {a.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={a.image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl text-[var(--subtle)]">
                      ♫
                    </div>
                  )}
                  <span className="absolute left-1.5 top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-black/70 px-1.5 text-[10px] font-bold tabular-nums text-white backdrop-blur">
                    #{a.rank}
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-white">
                    {a.name}
                  </div>
                  {a.genres[0] && (
                    <div className="truncate text-[10px] capitalize text-[var(--muted)]">
                      {a.genres[0]}
                    </div>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
