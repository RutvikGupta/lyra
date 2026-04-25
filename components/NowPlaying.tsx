"use client";

import { useEffect, useState } from "react";

type NowPlayingState = {
  authenticated: boolean;
  isPlaying?: boolean;
  track?: {
    name: string;
    uri: string;
    durationMs: number;
    progressMs: number;
    album: { name?: string; image?: string };
    artists: { name: string; uri: string }[];
  };
};

type Snapshot = { state: NowPlayingState; fetchedAt: number };

const POLL_MS = 2000;
const TICK_MS = 250;

export default function NowPlaying() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  // Bumped every TICK_MS while a track is playing so the progress bar
  // re-renders smoothly without re-hitting the API.
  const [, setTick] = useState(0);

  // Server poll
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function fetchOnce() {
      try {
        const res = await fetch("/api/now-playing", { cache: "no-store" });
        const next: NowPlayingState =
          res.status === 401 ? { authenticated: false } : await res.json();
        if (cancelled) return;
        setSnap({ state: next, fetchedAt: Date.now() });
      } catch {
        if (cancelled) return;
        setSnap({ state: { authenticated: false }, fetchedAt: Date.now() });
      }
      if (!cancelled) timer = setTimeout(fetchOnce, POLL_MS);
    }

    fetchOnce();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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

  if (!state.authenticated) {
    return (
      <a
        href="/api/auth/login"
        className="group inline-flex w-fit items-center gap-2.5 rounded-full bg-[var(--brand)] px-7 py-3.5 text-sm font-bold tracking-wide text-black shadow-[0_0_0_0_rgba(30,215,96,0)] transition-all hover:scale-[1.03] hover:bg-[var(--brand-hover)] hover:shadow-[0_0_30px_0_rgba(30,215,96,0.35)] active:scale-[0.99] active:bg-[var(--brand-pressed)]"
      >
        <SpotifyGlyph />
        Connect Spotify
      </a>
    );
  }

  if (!state.isPlaying || !state.track) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-[var(--surface)] px-5 py-4 text-sm text-[var(--muted)]">
        <span className="inline-block h-2 w-2 rounded-full bg-[var(--subtle)]" />
        Nothing playing right now. Press play in Spotify and this will light up.
      </div>
    );
  }

  const t = state.track;
  const elapsedSinceFetch = snap ? Date.now() - snap.fetchedAt : 0;
  const interpolatedMs = state.isPlaying
    ? Math.min(t.durationMs, t.progressMs + elapsedSinceFetch)
    : t.progressMs;
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
      {t.album.image && (
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
          {t.album.name ? ` · ${t.album.name}` : ""}
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

function SpotifyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-4 w-4"
      fill="currentColor"
    >
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.521 17.34a.748.748 0 0 1-1.03.249c-2.823-1.724-6.376-2.114-10.561-1.158a.748.748 0 1 1-.333-1.46c4.581-1.045 8.515-.594 11.676 1.34.351.214.464.674.248 1.029zm1.473-3.267a.935.935 0 0 1-1.286.308c-3.231-1.987-8.156-2.563-11.978-1.402a.935.935 0 1 1-.542-1.79c4.366-1.323 9.794-.679 13.498 1.598.44.27.582.847.308 1.286zm.13-3.403c-3.876-2.302-10.27-2.514-13.97-1.39a1.122 1.122 0 1 1-.65-2.148c4.244-1.286 11.302-1.038 15.764 1.612.534.317.71 1.008.394 1.541a1.122 1.122 0 0 1-1.538.385z" />
    </svg>
  );
}
