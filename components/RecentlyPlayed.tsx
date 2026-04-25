"use client";

import { useEffect, useState } from "react";

type Item = {
  playedAt: string;
  track: {
    name: string;
    uri: string;
    artists: string[];
    image?: string | null;
  };
};

export default function RecentlyPlayed() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [authed, setAuthed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch("/api/recently-played", { cache: "no-store" });
        if (r.status === 401) {
          if (!cancelled) {
            setAuthed(false);
            setItems([]);
          }
          return;
        }
        const data = await r.json();
        if (!cancelled) setItems(data.items ?? []);
      } catch {
        if (!cancelled) setItems([]);
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
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
