// Static snapshot of the owner's library, baked client-side and committed
// to public/. Lets unauthenticated visitors see the songs constellation
// /library renders for the owner, without giving them write access to
// IndexedDB or making the full play history public.
//
// Tradeoff: only "all time" view works from a snapshot — the time-of-day,
// year, day-of-week filters all need raw plays, which we deliberately
// don't ship. Owners still see the full filterable view because their
// IndexedDB data takes precedence.

import type { AggregatedArtist, AggregatedTrack } from "./aggregate";

export const SNAPSHOT_VERSION = 1;

export type LibrarySnapshot = {
  version: number;
  ownerName: string;
  exportedAt: number; // Date.now() at bake time
  totalPlays: number;
  totalMsPlayed: number;
  earliest: number;
  latest: number;
  // Pre-aggregated, sorted by msPlayed desc. Limit 200 each — enough for
  // a rich graph, small enough to ship as a static JSON (~50 KB).
  topTracks: AggregatedTrack[];
  topArtists: AggregatedArtist[];
  // Artist name (lowercase) → genres. Pulled from /api/library-artists at
  // export time so visitors don't have to re-enrich.
  artistGenres: Record<string, string[]>;
};
