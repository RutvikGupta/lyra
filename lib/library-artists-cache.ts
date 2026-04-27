// Client-side per-name cache for /api/library-artists. The endpoint
// enriches artists with Last.fm genre/listener/playcount data — the
// underlying enrichment is purely a function of the artist name (the
// per-user playCount / msPlayed / trackCount fields just pass through
// from the request body to the response). So we cache by lowercased
// artist name, fetch only the names that aren't cached, and merge
// in the caller's per-user fields on the way back out.
//
// Cuts the round-trip out of every library-mode Starfield mount when
// the user's top artists overlap with a previous session's. Also
// helps the Share / Publish flows.

import { readFreshCache, writeCache } from "./client-cache";

export type LibraryArtistInput = {
  name: string;
  playCount: number;
  msPlayed: number;
  trackCount: number;
};

export type LibraryArtistEnrichment = {
  genres: string[];
  listeners: number;
  playcount: number;
};

export type LibraryArtistItem = {
  id: string;
  rank: number;
  name: string;
  genres: string[];
  image: string | null;
  popularity: number;
  listeners: number;
  playcount: number;
  uri: string;
  myPlayCount: number;
  myMsPlayed: number;
  myTrackCount: number;
};

const NAME_CACHE_PREFIX = "lyra:lib-artist:";
// 7 days — Last.fm tags + listener counts barely move on this scale,
// and a stale entry just means slightly off "1.2M listeners" labels.
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

function cacheKeyFor(name: string): string {
  return `${NAME_CACHE_PREFIX}${name.toLowerCase()}`;
}

function shape(
  input: LibraryArtistInput,
  rank: number,
  enrichment: LibraryArtistEnrichment,
): LibraryArtistItem {
  return {
    id: `lib:${input.name.toLowerCase()}`,
    rank,
    name: input.name,
    genres: enrichment.genres,
    image: null,
    popularity: 0,
    listeners: enrichment.listeners,
    playcount: enrichment.playcount,
    uri: "",
    myPlayCount: input.playCount,
    myMsPlayed: input.msPlayed,
    myTrackCount: input.trackCount,
  };
}

export async function fetchLibraryArtistsCached(
  input: LibraryArtistInput[],
  init?: { signal?: AbortSignal },
): Promise<LibraryArtistItem[]> {
  if (input.length === 0) return [];

  // Pass 1: pull whatever we already have cached.
  const enrichments = new Map<string, LibraryArtistEnrichment>();
  const missing: LibraryArtistInput[] = [];
  for (const a of input) {
    const cached = readFreshCache<LibraryArtistEnrichment>(
      cacheKeyFor(a.name),
      CACHE_TTL,
    );
    if (cached) enrichments.set(a.name.toLowerCase(), cached);
    else missing.push(a);
  }

  // Pass 2: ask the server for only the artists we don't have cached.
  if (missing.length > 0) {
    const r = await fetch("/api/library-artists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artists: missing }),
      cache: "no-store",
      signal: init?.signal,
    });
    if (!r.ok) {
      throw new Error(`library-artists request failed (${r.status})`);
    }
    const data = (await r.json()) as { items?: LibraryArtistItem[] };
    for (const item of data.items ?? []) {
      const enrichment: LibraryArtistEnrichment = {
        genres: item.genres ?? [],
        listeners: item.listeners ?? 0,
        playcount: item.playcount ?? 0,
      };
      enrichments.set(item.name.toLowerCase(), enrichment);
      writeCache(cacheKeyFor(item.name), enrichment);
    }
  }

  // Pass 3: assemble the result in the caller's original input order
  // so `rank` matches the row position the caller expects.
  return input.map((a, i) => {
    const enrichment = enrichments.get(a.name.toLowerCase()) ?? {
      genres: [],
      listeners: 0,
      playcount: 0,
    };
    return shape(a, i + 1, enrichment);
  });
}
