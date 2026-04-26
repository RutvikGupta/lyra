// Client-side baker. Takes IndexedDB history + Last.fm-enriched artist
// data and produces a LibrarySnapshot ready to POST to the publish
// endpoint or download manually.

import {
  aggregateTopArtistsFromPlays,
  aggregateTopTracksFromPlays,
} from "./aggregate";
import type { LibrarySnapshot } from "./showcase-library";
import { SNAPSHOT_VERSION } from "./showcase-library";
import type { StoredHistory } from "./types";

const TOP_LIMIT = 200;

type EnrichedArtist = { name: string; genres: string[] };

export function bakeSnapshot(
  history: StoredHistory,
  ownerName: string,
  enrichedArtists: EnrichedArtist[],
): LibrarySnapshot {
  // Snapshot is "all-time" only — filter-aware views need raw plays which
  // we deliberately don't ship. Owner still gets the full filterable view
  // because IndexedDB takes precedence.
  const baseFilters = {
    timeOfDay: [],
    dayOfWeek: "all" as const,
    sessionEntry: "all" as const,
  };
  const topTracks = aggregateTopTracksFromPlays(history.plays, {
    year: "all",
    sortBy: "msPlayed",
    limit: TOP_LIMIT,
    lovedOnly: false,
    skipBucket: "any",
    discoveryYear: "all",
    ...baseFilters,
  });
  const topArtists = aggregateTopArtistsFromPlays(history.plays, {
    year: "all",
    sortBy: "msPlayed",
    limit: TOP_LIMIT,
    ...baseFilters,
  });

  const artistGenres: Record<string, string[]> = {};
  for (const a of enrichedArtists) {
    if (a.genres.length > 0) {
      artistGenres[a.name.toLowerCase()] = a.genres;
    }
  }

  return {
    version: SNAPSHOT_VERSION,
    ownerName,
    exportedAt: Date.now(),
    totalPlays: history.totalPlays,
    totalMsPlayed: history.totalMsPlayed,
    earliest: history.earliest,
    latest: history.latest,
    topTracks,
    topArtists,
    artistGenres,
  };
}
