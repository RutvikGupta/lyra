"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import {
  yearsWithPlays,
  type DayOfWeek,
  type SessionEntry,
  type SkipBucket,
  type TimeOfDay,
} from "@/lib/aggregate";
import { loadHistory } from "@/lib/storage";

export type LibraryCriteria = {
  kind: "library";
  nodeType: "tracks" | "artists";
  year: number | "all";
  sortBy: "msPlayed" | "playCount";
  limit: number;
  // Phase A filters
  timeOfDay: TimeOfDay[];
  dayOfWeek: DayOfWeek;
  sessionEntry: SessionEntry;
  lovedOnly: boolean;
  skipBucket: SkipBucket;
  discoveryYear: number | "all";
  // Phase B — Last.fm tag filter + alternative coloring scheme
  tags: string[];
  colorMode: "genre" | "cluster";
  // Mood lens — bucketed Last.fm tags ("chill", "energetic", etc.).
  // Empty array = no filter; otherwise keep nodes whose tags match any
  // selected mood. See lib/moods.ts for the taxonomy.
  moods: string[];
};

export type Criteria =
  | {
      kind: "api";
      timeRange: "short_term" | "medium_term" | "long_term";
      // Optional Last.fm/Spotify-genre filter for the api-mode
      // constellation. Empty / undefined = no filter. Mood filtering
      // and color-cluster overlays remain library-mode-only — those
      // need raw plays to be meaningful.
      tags?: string[];
    }
  | LibraryCriteria;

export const DEFAULT_LIBRARY_CRITERIA: LibraryCriteria = {
  kind: "library",
  nodeType: "tracks",
  year: "all",
  sortBy: "msPlayed",
  limit: 150,
  timeOfDay: [],
  dayOfWeek: "all",
  sessionEntry: "all",
  lovedOnly: false,
  skipBucket: "any",
  discoveryYear: "all",
  tags: [],
  colorMode: "genre",
  moods: [],
};

const ALL_TIME_OF_DAY: TimeOfDay[] = [
  "morning",
  "afternoon",
  "evening",
  "night",
];

function activeFilterCount(c: LibraryCriteria): number {
  let n = 0;
  if (c.timeOfDay.length > 0 && c.timeOfDay.length < 4) n++;
  if (c.dayOfWeek !== "all") n++;
  if (c.sessionEntry !== "all") n++;
  if (c.lovedOnly) n++;
  if (c.skipBucket !== "any") n++;
  if (c.discoveryYear !== "all") n++;
  return n;
}

const TIME_LABELS: Record<
  "short_term" | "medium_term" | "long_term",
  string
> = {
  short_term: "Last 4 weeks",
  medium_term: "Last 6 months",
  long_term: "All time",
};

const LIMIT_OPTIONS = [50, 100, 150, 200];

export default function CriteriaBar({
  criteria,
  onChange,
}: {
  criteria: Criteria;
  onChange: (next: Criteria) => void;
}) {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [hasLibrary, setHasLibrary] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadHistory().then(async (h) => {
      if (cancelled) return;
      const localHasPlays = !!h && h.plays.length > 0;
      setHasLibrary(localHasPlays);
      if (localHasPlays) {
        setAvailableYears(yearsWithPlays(h!.plays));
        return;
      }
      // No local history — try the snapshot. Lets visitors see the same
      // year filter options the owner sees, derived from the snapshot's
      // per-track firstPlayed timestamps.
      try {
        const r = await fetch("/api/showcase/library", { cache: "no-store" });
        if (!r.ok || cancelled) return;
        const snap = (await r.json()) as {
          earliest?: number;
          latest?: number;
          topTracks?: { firstPlayed?: number }[];
        };
        const years = new Set<number>();
        for (const t of snap.topTracks ?? []) {
          if (typeof t.firstPlayed === "number") {
            years.add(new Date(t.firstPlayed).getUTCFullYear());
          }
        }
        // Also include every year between earliest and latest play, so
        // the Year filter shows years even if no top track was first
        // discovered that year.
        if (snap.earliest && snap.latest) {
          const lo = new Date(snap.earliest).getUTCFullYear();
          const hi = new Date(snap.latest).getUTCFullYear();
          for (let y = lo; y <= hi; y++) years.add(y);
        }
        if (!cancelled && years.size > 0) {
          setAvailableYears(Array.from(years).sort((a, b) => b - a));
          // Treat the snapshot as a "library" too so the source toggle
          // doesn't disable the My Library button.
          setHasLibrary(true);
        }
      } catch {
        // ignore — leave availableYears empty
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectApi() {
    if (criteria.kind !== "api") {
      onChange({ kind: "api", timeRange: "long_term" });
    }
  }

  function selectLibrary() {
    if (criteria.kind !== "library") {
      onChange({ ...DEFAULT_LIBRARY_CRITERIA });
    }
  }

  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersBtnRef = useRef<HTMLButtonElement>(null);
  const filtersPanelRef = useRef<HTMLDivElement>(null);

  // Close filters panel on outside click / Escape.
  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (filtersPanelRef.current?.contains(target)) return;
      if (filtersBtnRef.current?.contains(target)) return;
      setFiltersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFiltersOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [filtersOpen]);

  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-50 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 flex-col items-center gap-2 px-2 sm:top-6">
      {/* Source toggle */}
      <div className="overlay-tab flex gap-1 rounded-full border border-white/10 p-1 backdrop-blur-md">
        <SourceButton
          active={criteria.kind === "api"}
          onClick={selectApi}
          glyph="🎧"
        >
          Spotify top
        </SourceButton>
        <SourceButton
          active={criteria.kind === "library"}
          onClick={selectLibrary}
          glyph="📚"
          disabled={hasLibrary === false}
          title={
            hasLibrary === false
              ? "Upload your Spotify ZIP first"
              : undefined
          }
        >
          My library
        </SourceButton>
      </div>

      {/* Per-source sub-controls */}
      {criteria.kind === "api" && (
        <Pills>
          {(Object.keys(TIME_LABELS) as Array<keyof typeof TIME_LABELS>).map(
            (r) => (
              <Pill
                key={r}
                active={criteria.timeRange === r}
                onClick={() => onChange({ kind: "api", timeRange: r })}
              >
                {TIME_LABELS[r]}
              </Pill>
            ),
          )}
        </Pills>
      )}

      {criteria.kind === "library" && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {/* Year picker — All + every year that has plays */}
          <PillSelect
            label={criteria.year === "all" ? "All time" : String(criteria.year)}
            options={[
              { value: "all", label: "All time" },
              ...availableYears.map((y) => ({
                value: String(y),
                label: String(y),
              })),
            ]}
            value={criteria.year === "all" ? "all" : String(criteria.year)}
            onSelect={(v) =>
              onChange({
                ...criteria,
                year: v === "all" ? "all" : Number(v),
              })
            }
          />

          {/* Sort by — "Total time" sums listening duration; "Total plays"
              counts every started play. Phrased as totals so the axis is
              unambiguous next to "Top 150" etc. */}
          <PillSelect
            label={
              criteria.sortBy === "msPlayed" ? "Total time" : "Total plays"
            }
            options={[
              { value: "msPlayed", label: "Total time" },
              { value: "playCount", label: "Total plays" },
            ]}
            value={criteria.sortBy}
            onSelect={(v) =>
              onChange({
                ...criteria,
                sortBy: v as "msPlayed" | "playCount",
              })
            }
          />

          {/* Limit */}
          <PillSelect
            label={`Top ${criteria.limit}`}
            options={LIMIT_OPTIONS.map((l) => ({
              value: String(l),
              label: `Top ${l}`,
            }))}
            value={String(criteria.limit)}
            onSelect={(v) => onChange({ ...criteria, limit: Number(v) })}
          />

          {/* Filters disclosure */}
          <button
            ref={filtersBtnRef}
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={`overlay-tab inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-[13px] font-bold backdrop-blur-md transition-colors ${
              activeFilterCount(criteria) > 0
                ? "text-[var(--brand)] hover:text-white"
                : "text-white/85 hover:text-white"
            }`}
            aria-expanded={filtersOpen}
          >
            <span>{filtersOpen ? "▾" : "▸"}</span>
            Filters
            {activeFilterCount(criteria) > 0 && (
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand)] px-1 text-[9px] font-bold text-black">
                {activeFilterCount(criteria)}
              </span>
            )}
          </button>
        </div>
      )}

      {criteria.kind === "library" && filtersOpen && (
        <FiltersPanel
          ref={filtersPanelRef}
          criteria={criteria}
          onChange={onChange}
          availableYears={availableYears}
        />
      )}
    </div>
  );
}

const FiltersPanel = forwardRef<
  HTMLDivElement,
  {
    criteria: LibraryCriteria;
    onChange: (next: LibraryCriteria) => void;
    availableYears: number[];
  }
>(function FiltersPanel({ criteria, onChange, availableYears }, ref) {
  function toggleTimeOfDay(t: TimeOfDay) {
    const set = new Set(criteria.timeOfDay);
    if (set.has(t)) set.delete(t);
    else set.add(t);
    onChange({ ...criteria, timeOfDay: Array.from(set) });
  }

  return (
    <div
      ref={ref}
      className="overlay-card flex max-w-[min(100vw-2rem,42rem)] flex-col gap-2 rounded-2xl border border-white/10 p-3 backdrop-blur-md"
    >
      {/* View — tracks vs artists. Lives inside the filter panel so the
          top criteria bar stays minimal. */}
      <FilterRow label="View">
        <Pill
          active={criteria.nodeType === "tracks"}
          onClick={() => onChange({ ...criteria, nodeType: "tracks" })}
        >
          Tracks
        </Pill>
        <Pill
          active={criteria.nodeType === "artists"}
          onClick={() => onChange({ ...criteria, nodeType: "artists" })}
        >
          Artists
        </Pill>
      </FilterRow>

      {/* When */}
      <FilterRow label="When">
        {ALL_TIME_OF_DAY.map((t) => (
          <Pill
            key={t}
            active={
              criteria.timeOfDay.length === 0 ||
              criteria.timeOfDay.length === 4
                ? false
                : criteria.timeOfDay.includes(t)
            }
            onClick={() => toggleTimeOfDay(t)}
          >
            {t}
          </Pill>
        ))}
        <Divider />
        <Pill
          active={criteria.dayOfWeek === "all"}
          onClick={() => onChange({ ...criteria, dayOfWeek: "all" })}
        >
          all days
        </Pill>
        <Pill
          active={criteria.dayOfWeek === "weekday"}
          onClick={() => onChange({ ...criteria, dayOfWeek: "weekday" })}
        >
          weekdays
        </Pill>
        <Pill
          active={criteria.dayOfWeek === "weekend"}
          onClick={() => onChange({ ...criteria, dayOfWeek: "weekend" })}
        >
          weekends
        </Pill>
      </FilterRow>

      {/* Engagement */}
      <FilterRow label="Engagement">
        <Pill
          active={criteria.lovedOnly}
          onClick={() =>
            onChange({ ...criteria, lovedOnly: !criteria.lovedOnly })
          }
        >
          ♥ Loved only
        </Pill>
        <Divider />
        <Pill
          active={criteria.skipBucket === "any"}
          onClick={() => onChange({ ...criteria, skipBucket: "any" })}
        >
          any skips
        </Pill>
        <Pill
          active={criteria.skipBucket === "low"}
          onClick={() => onChange({ ...criteria, skipBucket: "low" })}
        >
          low ≤20%
        </Pill>
        <Pill
          active={criteria.skipBucket === "none"}
          onClick={() => onChange({ ...criteria, skipBucket: "none" })}
        >
          ≤5% skips
        </Pill>
        <Divider />
        <Pill
          active={criteria.sessionEntry === "all"}
          onClick={() => onChange({ ...criteria, sessionEntry: "all" })}
        >
          any start
        </Pill>
        <Pill
          active={criteria.sessionEntry === "active"}
          onClick={() => onChange({ ...criteria, sessionEntry: "active" })}
        >
          you picked
        </Pill>
        <Pill
          active={criteria.sessionEntry === "auto"}
          onClick={() => onChange({ ...criteria, sessionEntry: "auto" })}
        >
          auto-played
        </Pill>
      </FilterRow>

      {/* Discovery year */}
      <FilterRow label="Discovered">
        <Pill
          active={criteria.discoveryYear === "all"}
          onClick={() => onChange({ ...criteria, discoveryYear: "all" })}
        >
          any time
        </Pill>
        {availableYears.map((y) => (
          <Pill
            key={y}
            active={criteria.discoveryYear === y}
            onClick={() => onChange({ ...criteria, discoveryYear: y })}
          >
            {y}
          </Pill>
        ))}
      </FilterRow>

      {activeFilterCount(criteria) > 0 && (
        <button
          type="button"
          onClick={() =>
            onChange({
              ...criteria,
              timeOfDay: [],
              dayOfWeek: "all",
              sessionEntry: "all",
              lovedOnly: false,
              skipBucket: "any",
              discoveryYear: "all",
            })
          }
          className="self-start rounded-full px-3 py-1 text-[12px] font-semibold text-[var(--muted)] hover:text-white"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
});

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-24 flex-shrink-0 text-[12px] font-bold uppercase tracking-[0.18em] text-white/80">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-3 w-px bg-white/10" aria-hidden />;
}

function Pills({ children }: { children: React.ReactNode }) {
  return (
    <div className="overlay-tab flex gap-1 rounded-full border border-white/10 p-1 backdrop-blur-md">
      {children}
    </div>
  );
}

// Collapsed pill group — shows only the currently-selected option until
// the user clicks it, then expands horizontally to reveal all options.
// Click outside / Escape collapses again. Frees up canvas space so users
// can see the constellation without a wall of unused pill rows.
function PillSelect({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onSelect: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (wrapperRef.current?.contains(target)) return;
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

  if (!open) {
    return (
      <button
        ref={(el) => {
          // Reuse the wrapper ref so click-outside detection still works
          // when the trigger is the only rendered element.
          if (wrapperRef.current === null && el) {
            (wrapperRef as { current: HTMLDivElement | null }).current =
              el as unknown as HTMLDivElement;
          }
        }}
        type="button"
        onClick={() => setOpen(true)}
        className="overlay-tab inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/10 px-4 py-2 text-[13px] font-bold text-white/85 backdrop-blur-md transition-colors hover:text-white"
      >
        {label}
        <span className="text-[10px] opacity-60">▾</span>
      </button>
    );
  }

  return (
    <div
      ref={wrapperRef}
      className="overlay-tab flex gap-1 rounded-full border border-white/10 p-1 backdrop-blur-md"
    >
      {options.map((opt) => (
        <Pill
          key={opt.value}
          active={opt.value === value}
          onClick={() => {
            onSelect(opt.value);
            setOpen(false);
          }}
        >
          {opt.label}
        </Pill>
      ))}
    </div>
  );
}

function Pill({
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
      className={`relative cursor-pointer rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors ${
        active
          ? "bg-white text-black"
          : "text-white/85 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function SourceButton({
  active,
  onClick,
  glyph,
  disabled,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  glyph: string;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-[var(--brand)] text-black"
          : "text-white/85 hover:bg-white/10 hover:text-white"
      }`}
    >
      <span aria-hidden>{glyph}</span>
      {children}
    </button>
  );
}
