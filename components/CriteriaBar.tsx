"use client";

import { useEffect, useState } from "react";
import { yearsWithPlays } from "@/lib/aggregate";
import { loadHistory } from "@/lib/storage";

export type Criteria =
  | {
      kind: "api";
      timeRange: "short_term" | "medium_term" | "long_term";
    }
  | {
      kind: "library";
      year: number | "all";
      sortBy: "msPlayed" | "playCount";
      limit: number;
    };

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
    loadHistory().then((h) => {
      if (cancelled) return;
      setHasLibrary(!!h && h.plays.length > 0);
      if (h?.plays?.length) setAvailableYears(yearsWithPlays(h.plays));
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
      onChange({
        kind: "library",
        year: "all",
        sortBy: "msPlayed",
        limit: 150,
      });
    }
  }

  return (
    <div className="pointer-events-auto absolute left-1/2 top-6 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {/* Source toggle */}
      <div className="flex gap-1 rounded-full border border-white/10 bg-black/75 p-1 backdrop-blur-md">
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
          <Pills>
            <Pill
              active={criteria.year === "all"}
              onClick={() => onChange({ ...criteria, year: "all" })}
            >
              All time
            </Pill>
            {availableYears.map((y) => (
              <Pill
                key={y}
                active={criteria.year === y}
                onClick={() => onChange({ ...criteria, year: y })}
              >
                {y}
              </Pill>
            ))}
          </Pills>

          {/* Sort by */}
          <Pills>
            <Pill
              active={criteria.sortBy === "msPlayed"}
              onClick={() => onChange({ ...criteria, sortBy: "msPlayed" })}
            >
              By time
            </Pill>
            <Pill
              active={criteria.sortBy === "playCount"}
              onClick={() => onChange({ ...criteria, sortBy: "playCount" })}
            >
              By plays
            </Pill>
          </Pills>

          {/* Limit */}
          <Pills>
            {LIMIT_OPTIONS.map((l) => (
              <Pill
                key={l}
                active={criteria.limit === l}
                onClick={() => onChange({ ...criteria, limit: l })}
              >
                Top {l}
              </Pill>
            ))}
          </Pills>
        </div>
      )}
    </div>
  );
}

function Pills({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1 rounded-full border border-white/10 bg-black/70 p-1 backdrop-blur-md">
      {children}
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
      className={`relative cursor-pointer rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
        active
          ? "bg-white text-black"
          : "text-[var(--muted)] hover:bg-white/10 hover:text-white"
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
      className={`relative inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-[var(--brand)] text-black"
          : "text-[var(--muted)] hover:bg-white/10 hover:text-white"
      }`}
    >
      <span aria-hidden>{glyph}</span>
      {children}
    </button>
  );
}
