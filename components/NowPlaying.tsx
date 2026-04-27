"use client";

import { useEffect, useState } from "react";

type NowPlayingState = {
  isPlaying?: boolean;
  progressMs?: number;
  track?: {
    name: string;
    uri: string;
    durationMs: number;
    album?: { name?: string; image?: string };
    artists: { name: string; uri: string }[];
  };
};

type Snapshot = { state: NowPlayingState; fetchedAt: number };

// Polling cadence. The progress bar is locally interpolated (see
// TICK_MS below): every 250ms we bump a counter so the bar re-renders
// using `Date.now() - fetchedAt`, drifting smoothly forward without a
// network call. That decouples server-poll frequency from visual
// smoothness, so we can poll every 5s for actual track changes (down
// from 1.5s, ~70% fewer requests against /me) without the bar ever
// looking jumpy.
const POLL_MS = 5000;
const TICK_MS = 250;

export default function NowPlaying() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  // Bumped every TICK_MS while a track is playing so the progress bar
  // re-renders smoothly without re-hitting the API.
  const [, setTick] = useState(0);

  // Server poll — public showcase route, refresh-token-backed.
  // Pauses while the tab is hidden so we don't burn Spotify quota /
  // battery on a visitor who tabbed away. Resumes with an immediate
  // refresh so the user sees current state on tab focus.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function fetchOnce() {
      if (typeof document !== "undefined" && document.hidden) {
        // Don't burn an interval while hidden — onVisibilityChange will
        // re-arm immediately when the user returns.
        return;
      }
      try {
        const res = await fetch("/api/now-playing", {
          cache: "no-store",
        });
        if (res.status === 503) {
          // Authed but Spotify token still propagating after OAuth.
          // Re-poll fast and keep existing state so the card doesn't
          // flicker to "Connecting…" between attempts.
          if (!cancelled) timer = setTimeout(fetchOnce, 1000);
          return;
        }
        const next: NowPlayingState = res.ok ? await res.json() : {};
        if (cancelled) return;
        setSnap({ state: next, fetchedAt: Date.now() });
      } catch {
        if (cancelled) return;
        setSnap({ state: {}, fetchedAt: Date.now() });
      }
      if (!cancelled) timer = setTimeout(fetchOnce, POLL_MS);
    }

    function onVisibility() {
      if (cancelled) return;
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = undefined;
      } else {
        if (timer) clearTimeout(timer);
        fetchOnce();
      }
    }

    fetchOnce();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Local progress tick (no network)
  const isPlaying = snap?.state.isPlaying === true;
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [isPlaying]);

  const state = snap?.state ?? null;

  if (!state) {
    return (
      <div className="rounded-2xl border border-white/[0.06] bg-[var(--surface)] px-5 py-4 text-sm text-[var(--muted)]">
        Connecting…
      </div>
    );
  }

  if (!state.isPlaying || !state.track) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-[var(--surface)] px-5 py-4 text-sm text-[var(--muted)]">
        <span className="inline-block h-2 w-2 rounded-full bg-[var(--subtle)]" />
        Nothing playing right now.
      </div>
    );
  }

  const t = state.track;
  const elapsedSinceFetch = snap ? Date.now() - snap.fetchedAt : 0;
  const baseProgress = state.progressMs ?? 0;
  const interpolatedMs = state.isPlaying
    ? Math.min(t.durationMs, baseProgress + elapsedSinceFetch)
    : baseProgress;
  const pct = t.durationMs > 0 ? (interpolatedMs / t.durationMs) * 100 : 0;
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, "0")}`;
  };

  return (
    <div className="group relative flex items-center gap-5 overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[var(--surface-elevated)] to-[var(--surface)] p-4 transition-colors hover:border-white/[0.12]">
      {/* Subtle green accent glow on the left */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-10 top-1/2 h-32 w-32 -translate-y-1/2 rounded-full bg-[var(--brand)]/20 blur-2xl"
      />
      {t.album?.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={t.album.image}
          alt={t.album.name ?? ""}
          className="relative h-24 w-24 flex-shrink-0 rounded-md object-cover shadow-2xl shadow-black/50"
        />
      )}
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
            Now playing
          </span>
        </div>
        <div className="mt-1 truncate text-xl font-bold text-white">
          {t.name}
        </div>
        <div className="truncate text-sm text-[var(--muted)]">
          {t.artists.map((a) => a.name).join(", ")}
          {t.album?.name ? ` · ${t.album.name}` : ""}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] tabular-nums text-[var(--muted)]">
          <span>{fmt(interpolatedMs)}</span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white transition-[width] duration-200 ease-linear group-hover:bg-[var(--brand)]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span>{fmt(t.durationMs)}</span>
        </div>
      </div>
    </div>
  );
}

