"use client";

import { useEffect, useState } from "react";
import {
  readFreshCache,
  readStaleCache,
  writeCache,
} from "@/lib/client-cache";

type Item = {
  playedAt: string;
  track: {
    name: string;
    uri: string;
    artists: string[];
    image?: string | null;
  };
};

// Recently-played updates whenever the user finishes a track. 2 min
// TTL keeps the list usefully fresh during an active listening session
// — a typical pop song is ~3 min, so the list updates within roughly
// one track's worth of latency. Polled on the same cadence so a user
// with the tab open sees new tracks without manually refreshing.
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const POLL_MS = 2 * 60 * 1000;
const CACHE_KEY = "lyra:recently-played";

export default function RecentlyPlayed() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [authed, setAuthed] = useState(true);
  // Tick every 30s so "Xm ago" labels stay accurate between polls.
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const initialFresh = readFreshCache<Item[]>(CACHE_KEY, CACHE_TTL);
    if (initialFresh) setItems(initialFresh);
    else {
      const stale = readStaleCache<Item[]>(CACHE_KEY);
      if (stale) setItems(stale);
    }

    // Right after OAuth, Spotify's access-token issuance can lag a few
    // seconds — the API returns 503 with `retrying:true` in that window.
    // Retry on a short backoff (1s, 2s, 4s) so the section populates
    // automatically instead of requiring a manual refresh.
    const RETRY_DELAYS = [1000, 2000, 4000];
    let retryIdx = 0;
    // Tracked so the rate-limited / error branches know whether they
    // can fall back to a cached list. Read fresh inside `load` so each
    // poll tick uses an up-to-date view of localStorage.
    function currentStale(): Item[] | null {
      return readStaleCache<Item[]>(CACHE_KEY);
    }

    async function load() {
      try {
        const r = await fetch("/api/recently-played", { cache: "no-store" });
        if (r.status === 503) {
          if (!cancelled && retryIdx < RETRY_DELAYS.length) {
            retryTimer = setTimeout(load, RETRY_DELAYS[retryIdx++]);
          } else if (!cancelled && !currentStale()) {
            setItems([]);
          }
          return;
        }
        if (!r.ok) {
          if (!cancelled && !currentStale()) setItems([]);
          return;
        }
        const data = await r.json();
        if (cancelled) return;
        const next = (data.items as Item[]) ?? [];
        if (data.rateLimited && next.length === 0) {
          if (!currentStale()) setItems([]);
          return;
        }
        setItems(next);
        if (next.length > 0) writeCache(CACHE_KEY, next);
        retryIdx = 0;
      } catch {
        if (!cancelled && !currentStale()) setItems([]);
      }
    }

    function schedulePoll() {
      if (cancelled) return;
      pollTimer = setTimeout(async () => {
        if (cancelled) return;
        if (typeof document !== "undefined" && document.hidden) {
          // Pause polling on hidden tabs to avoid burning Spotify
          // quota / battery. visibilitychange will re-arm.
          schedulePoll();
          return;
        }
        await load();
        schedulePoll();
      }, POLL_MS);
    }

    function onVisibility() {
      if (cancelled) return;
      if (!document.hidden) {
        // Tab came back: refresh immediately if cache is past TTL,
        // then re-arm the poll.
        if (pollTimer) clearTimeout(pollTimer);
        const stillFresh = readFreshCache<Item[]>(CACHE_KEY, CACHE_TTL);
        if (!stillFresh) load();
        schedulePoll();
      }
    }

    // Skip the initial fetch when the cache is fresh — render-from-
    // cache stays a zero-network path. Poll still arms so the list
    // updates on cadence.
    if (!initialFresh) load();
    schedulePoll();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!authed) return null;
  if (items === null) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--muted)]">
        Loading recent listens…
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <ol className="overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--surface)]">
      {items.slice(0, 8).map((item, i) => (
        <li
          key={`${item.track.uri}-${item.playedAt}-${i}`}
          className="flex items-center gap-3 border-b border-white/[0.04] px-3 py-2.5 last:border-b-0 hover:bg-[var(--surface-elevated)]"
        >
          <span className="w-5 flex-shrink-0 text-right text-xs tabular-nums text-[var(--subtle)]">
            {i + 1}
          </span>
          {item.track.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.track.image}
              alt=""
              className="h-9 w-9 flex-shrink-0 rounded"
            />
          ) : (
            <div className="h-9 w-9 flex-shrink-0 rounded bg-white/[0.06]" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">
              {item.track.name}
            </div>
            <div className="truncate text-xs text-[var(--muted)]">
              {item.track.artists.join(", ")}
            </div>
          </div>
          <span className="flex-shrink-0 text-xs text-[var(--subtle)]">
            {relative(item.playedAt)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
