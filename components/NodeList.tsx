"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode } from "@/lib/graph";

export default function NodeList({
  nodes,
  selectedId,
  onSelect,
  sortLabel,
}: {
  nodes: GraphNode[];
  selectedId?: string;
  onSelect: (node: GraphNode) => void;
  // Optional human-readable description of the active sort, e.g. "Total time".
  // Shown under the count so users know what the ordering reflects.
  sortLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — matches TagsPanel + FiltersPanel
  // so canvas behavior is consistent across overlays.
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

  const filtered = useMemo(() => {
    if (!query.trim()) return nodes;
    const q = query.toLowerCase().trim();
    return nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        (n.artistName && n.artistName.toLowerCase().includes(q)),
    );
  }, [nodes, query]);

  // Auto-scroll to selected item when selection changes from the canvas.
  useEffect(() => {
    if (!open || !selectedId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>(
      `[data-node-id="${cssEscape(selectedId)}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedId, open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="overlay-tab pointer-events-auto absolute left-4 top-24 z-50 inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-[13px] font-bold text-white/85 backdrop-blur-md transition-colors hover:text-white"
        aria-expanded={open}
      >
        <span>{open ? "◀" : "▶"}</span>
        List ({nodes.length})
      </button>

      {open && (
        <div
          ref={panelRef}
          className="overlay-card pointer-events-auto absolute bottom-28 left-4 top-36 z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-hidden rounded-2xl border border-white/10 p-3 backdrop-blur-md"
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] text-white placeholder-[var(--subtle)] outline-none focus:border-[var(--brand)]/60"
          />
          <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.18em] text-white/75">
            <span>
              {filtered.length === nodes.length
                ? `${nodes.length} in view`
                : `${filtered.length} of ${nodes.length}`}
            </span>
            {sortLabel && (
              <>
                <span className="text-white/30">·</span>
                <span className="text-[var(--brand)]">↓ {sortLabel}</span>
              </>
            )}
          </div>
          <ol
            ref={listRef}
            className="flex-1 overflow-y-auto rounded-lg"
            // Visible thumb on the dark panel
            style={{ scrollbarColor: "#4d4d4d transparent" }}
          >
            {filtered.map((n) => {
              const selected = n.id === selectedId;
              const isTrack = !!n.artistName;
              return (
                <li
                  key={n.id}
                  data-node-id={n.id}
                  onClick={() => onSelect(n)}
                  className={`group flex cursor-pointer items-center gap-2.5 border-b border-white/[0.04] px-2 py-2 transition-colors last:border-b-0 ${
                    selected
                      ? "bg-[var(--brand)]/10 hover:bg-[var(--brand)]/15"
                      : "hover:bg-white/[0.06]"
                  }`}
                >
                  <span
                    className={`w-8 flex-shrink-0 text-right text-[12px] font-bold tabular-nums ${
                      selected
                        ? "text-[var(--brand)]"
                        : "text-[var(--subtle)] group-hover:text-white"
                    }`}
                  >
                    #{n.rank}
                  </span>
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: n.color }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate text-[13px] font-semibold ${
                        selected ? "text-white" : "text-zinc-200"
                      }`}
                    >
                      {n.name}
                    </div>
                    {isTrack && (
                      <div className="truncate text-[12px] text-[var(--muted)]">
                        {n.artistName}
                      </div>
                    )}
                  </div>
                  {(n.myPlayCount ?? 0) > 0 && (
                    <span className="flex-shrink-0 text-[12px] tabular-nums text-[var(--subtle)]">
                      {n.myPlayCount}
                    </span>
                  )}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-6 text-center text-[13px] text-[var(--muted)]">
                No matches.
              </li>
            )}
          </ol>
        </div>
      )}
    </>
  );
}

// Minimal CSS.escape shim for older browsers.
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return s.replace(/(["\\\][:.#()])/g, "\\$1");
}
