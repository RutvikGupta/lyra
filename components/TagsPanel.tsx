"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { topTagsFromNodes } from "@/lib/cluster";
import type { GraphNode } from "@/lib/graph";
import { MOODS, moodsForTags } from "@/lib/moods";
import type { LibraryCriteria } from "./CriteriaBar";

export default function TagsPanel({
  rawNodes,
  criteria,
  onChange,
  showCoPlay,
  onShowCoPlayChange,
}: {
  rawNodes: GraphNode[];
  criteria: LibraryCriteria;
  onChange: (next: LibraryCriteria) => void;
  showCoPlay: boolean;
  onShowCoPlayChange: (next: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — matches the FiltersPanel pattern in
  // CriteriaBar so the canvas behaves consistently across overlays.
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

  const availableTags = useMemo(
    () => topTagsFromNodes(rawNodes, 28),
    [rawNodes],
  );

  // Tally which moods are actually present in this graph + how many nodes
  // each mood would match. Skips moods with zero hits so we don't show
  // chips that filter to nothing.
  const moodCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of rawNodes) {
      const matched = moodsForTags(n.genres);
      for (const id of matched) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [rawNodes]);
  const presentMoods = useMemo(
    () => MOODS.filter((m) => (moodCounts.get(m.id) ?? 0) > 0),
    [moodCounts],
  );

  // Don't render the panel when there are no tags — for a freshly-uploaded
  // library before enrichment finishes, we'd just show an empty box.
  if (availableTags.length === 0) return null;

  const selected = new Set(criteria.tags);
  const selectedMoods = new Set(criteria.moods);
  function toggleTag(t: string) {
    const next = new Set(selected);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange({ ...criteria, tags: Array.from(next) });
  }
  function toggleMood(id: string) {
    const next = new Set(selectedMoods);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...criteria, moods: Array.from(next) });
  }

  const activeCount =
    criteria.tags.length +
    criteria.moods.length +
    (criteria.colorMode === "cluster" ? 1 : 0) +
    (showCoPlay ? 1 : 0);

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
        Tags & color
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
          {/* Color mode */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/80">
              Color by
            </div>
            <div className="flex gap-1 self-start rounded-full border border-white/10 bg-black/60 p-1">
              <ToggleChip
                active={criteria.colorMode === "genre"}
                onClick={() =>
                  onChange({ ...criteria, colorMode: "genre" })
                }
              >
                Genre
              </ToggleChip>
              <ToggleChip
                active={criteria.colorMode === "cluster"}
                onClick={() =>
                  onChange({
                    ...criteria,
                    // Click an already-active Cluster → fall back to Genre.
                    // Lets users deselect without hunting for the Genre pill.
                    colorMode:
                      criteria.colorMode === "cluster" ? "genre" : "cluster",
                  })
                }
              >
                Cluster
              </ToggleChip>
            </div>
          </div>

          {/* Co-play overlay */}
          <div className="flex flex-col gap-1.5">
            <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/80">
              Overlays
            </div>
            <button
              type="button"
              onClick={() => onShowCoPlayChange(!showCoPlay)}
              className={`self-start rounded-full px-4 py-1.5 text-[12px] font-bold transition-colors ${
                showCoPlay
                  ? "bg-[var(--brand)] text-black"
                  : "border border-white/10 bg-black/60 text-white/85 hover:text-white"
              }`}
            >
              ✦ Show co-played
            </button>
          </div>

          {/* Mood lens */}
          {presentMoods.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Mood
                  {criteria.moods.length > 0 && (
                    <span className="ml-1.5 text-[var(--brand)]">
                      {criteria.moods.length}
                    </span>
                  )}
                </div>
                {criteria.moods.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...criteria, moods: [] })}
                    className="text-[11px] font-semibold text-[var(--muted)] hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {presentMoods.map((m) => {
                  const active = selectedMoods.has(m.id);
                  const count = moodCounts.get(m.id) ?? 0;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMood(m.id)}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
                        active
                          ? "border-[var(--brand)] bg-[var(--brand)]/20 text-white"
                          : "border-white/10 bg-white/[0.04] text-white/85 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      <span aria-hidden>{m.emoji}</span>
                      {m.label}
                      <span className="ml-0.5 text-[11px] font-medium tabular-nums text-white/55">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tag chips */}
          <div className="flex flex-1 flex-col gap-1.5 overflow-hidden">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/80">
                Tags
                {criteria.tags.length > 0 && (
                  <span className="ml-1.5 text-[var(--brand)]">
                    {criteria.tags.length}
                  </span>
                )}
              </div>
              {criteria.tags.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChange({ ...criteria, tags: [] })}
                  className="text-[10px] font-medium text-[var(--muted)] hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 overflow-y-auto pr-1">
              {availableTags.map(({ tag, count }) => {
                const active = selected.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full border px-3 py-1 text-[12px] font-semibold capitalize transition-colors ${
                      active
                        ? "border-[var(--brand)] bg-[var(--brand)]/20 text-white"
                        : "border-white/10 bg-white/[0.04] text-white/85 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {tag}
                    <span className="ml-1 text-[11px] font-medium tabular-nums text-white/55">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-[12px] font-bold transition-colors ${
        active
          ? "bg-white text-black"
          : "text-white/75 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
