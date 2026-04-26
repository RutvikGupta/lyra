"use client";

import { useState } from "react";
import CriteriaBar, { type Criteria } from "./CriteriaBar";
import ShareConstellationButton from "./ShareConstellationButton";
import Starfield from "./Starfield";

const DEFAULT_CRITERIA: Criteria = { kind: "api", timeRange: "long_term" };

export default function ExploreView({
  initialCriteria,
  share,
}: {
  initialCriteria?: Criteria;
  // When set, renders a ShareConstellationButton positioned alongside
  // ← Lyra. The button captures the *current* criteria (specifically
  // timeRange in artists mode) so the recipient sees the same view.
  share?: { mode: "library" | "artists" };
}) {
  const [criteria, setCriteria] = useState<Criteria>(
    initialCriteria ?? DEFAULT_CRITERIA,
  );
  const shareTimeRange =
    share?.mode === "artists" && criteria.kind === "api"
      ? criteria.timeRange
      : undefined;
  return (
    <>
      {share && (
        // Top-right corner — clear of ← Lyra (top-left), the centered
        // source toggle / filter chips (top-center), and the
        // ShowcaseOwnerBanner that occupies left-20 top-5 for visitors.
        <div className="pointer-events-none absolute right-5 top-5 z-30 flex flex-wrap items-start gap-2 sm:right-6 sm:top-6">
          <ShareConstellationButton
            mode={share.mode}
            timeRange={shareTimeRange}
          />
        </div>
      )}
      <Starfield criteria={criteria} onCriteriaChange={setCriteria} />
      <CriteriaBar criteria={criteria} onChange={setCriteria} />
    </>
  );
}
