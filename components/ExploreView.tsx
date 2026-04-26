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
        // Right-side, stacked below "▶ Tags & color" (which is right-4
        // top-3 in library mode). On /explore there's no Tags button,
        // so the share button just sits alone in the same slot.
        // Bottom-right is taken by NowPlayingPill, top-left by ← Lyra
        // and the publish/banner row, top-center by the source toggle.
        <div className="pointer-events-none absolute right-4 top-16 z-30 flex flex-wrap items-start gap-2 sm:top-20">
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
