"use client";

import { useState } from "react";
import CriteriaBar, { type Criteria } from "./CriteriaBar";
import Starfield from "./Starfield";

const DEFAULT_CRITERIA: Criteria = { kind: "api", timeRange: "long_term" };

export default function ExploreView({
  initialCriteria,
}: {
  initialCriteria?: Criteria;
}) {
  const [criteria, setCriteria] = useState<Criteria>(
    initialCriteria ?? DEFAULT_CRITERIA,
  );
  return (
    <>
      <Starfield criteria={criteria} />
      <CriteriaBar criteria={criteria} onChange={setCriteria} />
    </>
  );
}
