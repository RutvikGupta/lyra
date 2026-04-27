"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode } from "@/lib/graph";
import type { Criteria } from "./CriteriaBar";

// Slim genre-only filter for api mode (Spotify-top constellation).
// TagsPanel covers library mode and depends on raw plays, mood maps,
// and cluster coloring — all things the api branch doesn't have. This
// panel exposes only the tag-chip subset, anchored in the same spot
// as TagsPanel so the share-button positioning still holds.

export default function ArtistTagsPanel({
  rawNodes,
  criteria,
  onChange,
}: {
  rawNodes: GraphNode[];
  criteria: Extract<Criteria, { kind: "api" }>;
  onChange: (next: Extract<Criteria, { kind: "api" }>) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Frequency-rank the genres present in the current artist set so the
  // most representative tags surface first. Cap at 50 to keep the panel
  // scannable; rare one-offs are still searchable via the input.
  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of rawNodes) {
      for (const g of n.genres) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 50)
      .map(([t]) => t);
  }, [rawNodes]);

  const selected = useMemo(
    () => new Set(criteria.tags ?? []),
    [criteria.tags],
  );

  const [query, setQuery] = useState("");
  const filteredTags = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return topTags;
    return topTags.filter((t) => t.toLowerCase().includes(q));
  }, [topTags, query]);

  function toggle(t: string) {
    const next = new Set(selected);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange({ ...criteria, tags: Array.from(next) });
  }

  function clear() {
    onChange({ ...criteria, tags: [] });
  }

  const activeCount = selected.size;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`overlay-tab pointer-events-auto absolute right-4 top-3 z-50 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[12px] font-bold backdrop-blur-md transition-colors hover:text-white sm:top-5 ${
          activeCount > 0 ? "text-[var(--brand)]" : "text-white/85"
        }`}
        aria-expanded={open}
      >
        <span>{open ? "◀" : "▶"}</span>
        Genres
        {activeCount > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[9px] font-bold text-black">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          className="overlay-card pointer-events-auto absolute bottom-32 right-4 z-40 flex max-h-[min(60vh,32rem)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 p-3 backdrop-blur-md"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/80">
              Genres
            </div>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={clear}
                className="cursor-pointer rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)] transition-colors hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[12px] text-white placeholder:text-[var(--subtle)] focus:border-[var(--brand)]/40 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1.5 overflow-y-auto">
            {filteredTags.length === 0 ? (
              <div className="px-1 py-2 text-[11px] text-[var(--muted)]">
                No genres match.
              </div>
            ) : (
              filteredTags.map((t) => {
                const active = selected.has(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggle(t)}
                    className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                      active
                        ? "border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]"
                        : "border-white/10 bg-white/[0.03] text-white/85 hover:border-white/20 hover:bg-white/[0.06]"
                    }`}
                  >
                    {t}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}
