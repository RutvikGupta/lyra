"use client";

import { useState } from "react";
import CriteriaBar, { type Criteria } from "./CriteriaBar";
import Starfield from "./Starfield";
import { isArtistsSnapshot, type Snapshot } from "@/lib/showcase-library";

// Renders a shared snapshot. Inlines the snapshot as initialSnapshot so
// Starfield doesn't have to round-trip /api/share/{id} again. Reuses the
// same Starfield + CriteriaBar so visitors get the full filterable
// experience (within the limits of what's baked into the snapshot —
// all-time stats and per-track firstPlayed, no raw plays).

const DEFAULT_LIBRARY_CRITERIA: Criteria = {
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

export default function SharedConstellation({
  snapshot,
}: {
  snapshot: Snapshot;
}) {
  const initial: Criteria = isArtistsSnapshot(snapshot)
    ? { kind: "api", timeRange: snapshot.timeRange }
    : DEFAULT_LIBRARY_CRITERIA;
  const [criteria, setCriteria] = useState<Criteria>(initial);
  return (
    <>
      <Starfield
        criteria={criteria}
        onCriteriaChange={setCriteria}
        sharedSnapshot={snapshot}
      />
      <CriteriaBar criteria={criteria} onChange={setCriteria} />
    </>
  );
}
