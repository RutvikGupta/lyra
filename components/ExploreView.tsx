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
        // Same y as ▶ Tags & color (which sits at right-4 top-3 sm:top-5),
        // offset far enough left that even with the active-count badge
        // there's no overlap. On /explore there's no Tags button, so the
        // empty space to the left of where Tags would be is unused
        // anyway. Avoids the top-16 right-4 zone where the node-info
        // popup opens (top-20 right-4).
        <div className="pointer-events-none absolute right-52 top-3 z-30 flex flex-wrap items-start gap-2 sm:right-60 sm:top-5">
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
