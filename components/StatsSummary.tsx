"use client";

import type { Artist, StoredHistory, Track } from "@/lib/types";

export default function StatsSummary({
  history,
  onReset,
}: {
  history: StoredHistory;
  onReset: () => void;
}) {
  const topTracks = [...history.tracks]
    .sort((a, b) => b.playCount - a.playCount)
    .slice(0, 10);
  const topArtists = [...history.artists]
    .sort((a, b) => b.totalMsPlayed - a.totalMsPlayed)
    .slice(0, 10);

  const totalHours = history.totalMsPlayed / 1000 / 60 / 60;
  const yearStart = new Date(history.earliest).getFullYear();
  const yearEnd = new Date(history.latest).getFullYear();
  const dayCount = Math.max(
    1,
    Math.round((history.latest - history.earliest) / (1000 * 60 * 60 * 24)),
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
            ✓ Parsed · {sourceLabel(history.source)}
          </div>
          <div className="mt-1 text-sm text-[var(--muted)]">
            {history.totalPlays.toLocaleString()} plays ·{" "}
            {history.tracks.length.toLocaleString()} unique tracks ·{" "}
            {history.artists.length.toLocaleString()} unique artists
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-white/10 px-4 py-2 text-xs font-medium text-[var(--muted)] transition-colors hover:border-white/20 hover:text-white"
        >
          Clear & re-upload
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total plays" value={history.totalPlays.toLocaleString()} />
        <Stat label="Listening time" value={`${Math.round(totalHours)} hrs`} />
        <Stat label="Unique tracks" value={history.tracks.length.toLocaleString()} />
        <Stat
          label="Span"
          value={
            yearStart === yearEnd
              ? `${yearStart} (${dayCount} days)`
              : `${yearStart}–${yearEnd}`
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RankedList title="Top tracks" items={topTracks.map(toTrackRow)} />
        <RankedList title="Top artists" items={topArtists.map(toArtistRow)} />
      </div>

      {history.source === "account" && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100/90">
          <strong className="font-semibold text-amber-100">Heads up:</strong>{" "}
          this is the 12-month <em>Account Data</em> file, which doesn&apos;t
          include track URIs. We can build the listening table and a coarse
          artist graph from this, but the full track-level 3D starfield needs
          your <em>Extended Streaming History</em> ZIP (which gives us URIs to
          look up per-artist genres).
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[var(--surface)] p-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

type Row = { primary: string; secondary: string; tail: string };

function toTrackRow(t: Track): Row {
  return {
    primary: t.name,
    secondary: t.artistName,
    tail: `${t.playCount} plays`,
  };
}

function toArtistRow(a: Artist): Row {
  const hours = a.totalMsPlayed / 1000 / 60 / 60;
  return {
    primary: a.name,
    secondary: `${a.trackCount} tracks · ${a.playCount} plays`,
    tail: `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} hrs`,
  };
}

function RankedList({ title, items }: { title: string; items: Row[] }) {
  return (
    <div>
      <h3 className="mb-3 text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
        {title}
      </h3>
      <ol className="overflow-hidden rounded-xl border border-white/[0.06] bg-[var(--surface)]">
        {items.map((it, i) => (
          <li
            key={i}
            className="group flex items-center gap-4 border-b border-white/[0.04] px-4 py-3 last:border-b-0 hover:bg-[var(--surface-elevated)]"
          >
            <span className="w-6 flex-shrink-0 text-right text-sm font-bold text-[var(--subtle)] group-hover:text-[var(--brand)]">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">
                {it.primary}
              </div>
              <div className="truncate text-xs text-[var(--muted)]">
                {it.secondary}
              </div>
            </div>
            <span className="flex-shrink-0 text-xs tabular-nums text-[var(--muted)]">
              {it.tail}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function sourceLabel(source: StoredHistory["source"]): string {
  switch (source) {
    case "extended":
      return "Extended Streaming History";
    case "account":
      return "Account Data (12 months)";
    case "mixed":
      return "Extended + Account Data";
  }
}
