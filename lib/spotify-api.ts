import { spotifyFetch } from "./spotify";

export type SpotifyImage = { url: string; width: number; height: number };

export type SpotifyArtist = {
  id: string;
  name: string;
  genres: string[];
  images: SpotifyImage[];
  popularity: number;
  uri: string;
  external_urls?: { spotify?: string };
  // Augmented by enrichArtists() from Last.fm.
  lastfmListeners?: number;
  lastfmPlaycount?: number;
};

export type SpotifyTrack = {
  id: string;
  name: string;
  uri: string;
  duration_ms: number;
  popularity: number;
  album: { name: string; images: SpotifyImage[]; release_date?: string };
  artists: { id: string; name: string; uri: string }[];
  external_urls?: { spotify?: string };
};

export type SpotifyUser = {
  id: string;
  display_name: string;
  images: SpotifyImage[];
  external_urls?: { spotify?: string };
};

export type RecentlyPlayedItem = {
  played_at: string;
  track: SpotifyTrack;
};

type Paged<T> = { items: T[]; total?: number; limit?: number; offset?: number };

export type TimeRange = "short_term" | "medium_term" | "long_term";

async function getJson<T>(path: string): Promise<T | null> {
  const res = await spotifyFetch(path);
  if (!res || !res.ok) return null;
  return (await res.json()) as T;
}

export function fetchProfile() {
  return getJson<SpotifyUser>("/me");
}

// Spotify removed `genres` from list endpoints post-Nov 2024 and (verified
// April 2026) /artists/{id} now also returns empty arrays. So we fall back to
// Last.fm `artist.getTopTags` when LASTFM_API_KEY is set.
// Spotify also removed `popularity` from artist responses in Feb 2026, so we
// pull `listeners` and `playcount` from Last.fm `artist.getInfo`.

type ArtistStats = { listeners: number; playcount: number };

const genreCache = new Map<string, string[]>();
const statsCache = new Map<string, ArtistStats>();

async function fetchLastfmTags(artistName: string): Promise<string[]> {
  const key = process.env.LASTFM_API_KEY;
  if (!key || !artistName) return [];
  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.searchParams.set("method", "artist.getTopTags");
  url.searchParams.set("artist", artistName);
  url.searchParams.set("api_key", key);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");
  try {
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { "User-Agent": "listening-web/0.1" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      toptags?: { tag?: { name: string; count: string | number }[] };
    };
    const tags = data.toptags?.tag;
    if (!Array.isArray(tags)) return [];
    const lowerArtistName = artistName.toLowerCase();
    return tags
      .filter((t) => Number(t.count) >= 10)
      .map((t) => String(t.name).toLowerCase().trim())
      .filter(Boolean)
      // Skip generic "tag is the artist's name" garbage
      .filter((tag) => tag !== lowerArtistName)
      .slice(0, 6);
  } catch {
    return [];
  }
}

export async function fetchArtistGenres(
  artistId: string,
  artistName?: string,
): Promise<string[]> {
  const cached = genreCache.get(artistId);
  if (cached) return cached;
  const data = await getJson<{ genres?: string[] }>(`/artists/${artistId}`);
  let genres = Array.isArray(data?.genres) ? data!.genres : [];
  if (genres.length === 0 && artistName) {
    genres = await fetchLastfmTags(artistName);
  }
  genreCache.set(artistId, genres);
  return genres;
}

async function fetchLastfmStats(artistName: string): Promise<ArtistStats> {
  const key = process.env.LASTFM_API_KEY;
  if (!key || !artistName) return { listeners: 0, playcount: 0 };
  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.searchParams.set("method", "artist.getInfo");
  url.searchParams.set("artist", artistName);
  url.searchParams.set("api_key", key);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");
  try {
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { "User-Agent": "listening-web/0.1" },
    });
    if (!res.ok) return { listeners: 0, playcount: 0 };
    const data = (await res.json()) as {
      artist?: { stats?: { listeners?: string; playcount?: string } };
    };
    const listeners = parseInt(data.artist?.stats?.listeners ?? "0", 10) || 0;
    const playcount = parseInt(data.artist?.stats?.playcount ?? "0", 10) || 0;
    return { listeners, playcount };
  } catch {
    return { listeners: 0, playcount: 0 };
  }
}

export async function fetchArtistStats(
  artistId: string,
  artistName?: string,
): Promise<ArtistStats> {
  const cached = statsCache.get(artistId);
  if (cached) return cached;
  const stats = artistName
    ? await fetchLastfmStats(artistName)
    : { listeners: 0, playcount: 0 };
  statsCache.set(artistId, stats);
  return stats;
}

export async function enrichArtists(
  artists: SpotifyArtist[],
): Promise<SpotifyArtist[]> {
  // Per artist we may run up to 3 remote calls (Spotify /artists/{id}, Last.fm
  // getTopTags, Last.fm getInfo) but each is cached individually. To respect
  // Last.fm's ~5 req/s soft limit, chunk 3 artists × 2 Last.fm calls = 6
  // concurrent requests per batch.
  const CHUNK = 3;
  const genreMap = new Map<string, string[]>();
  const statsMap = new Map<string, ArtistStats>();

  for (let i = 0; i < artists.length; i += CHUNK) {
    const chunk = artists.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (a) => {
        const [genres, stats] = await Promise.all([
          fetchArtistGenres(a.id, a.name),
          fetchArtistStats(a.id, a.name),
        ]);
        genreMap.set(a.id, genres);
        statsMap.set(a.id, stats);
      }),
    );
  }

  let withGenres = 0;
  let withStats = 0;
  for (const g of genreMap.values()) if (g.length > 0) withGenres++;
  for (const s of statsMap.values()) if (s.listeners > 0) withStats++;
  console.log(
    `[enrich] genres ${withGenres}/${artists.length} · stats ${withStats}/${artists.length}`,
  );

  return artists.map((a) => {
    const genres = genreMap.get(a.id);
    const stats = statsMap.get(a.id);
    return {
      ...a,
      genres: genres && genres.length > 0 ? genres : (a.genres ?? []),
      lastfmListeners: stats?.listeners,
      lastfmPlaycount: stats?.playcount,
    };
  });
}

export function fetchTopArtists(time_range: TimeRange = "long_term", limit = 50) {
  return getJson<Paged<SpotifyArtist>>(
    `/me/top/artists?time_range=${time_range}&limit=${limit}`,
  );
}

export function fetchTopTracks(time_range: TimeRange = "long_term", limit = 50) {
  return getJson<Paged<SpotifyTrack>>(
    `/me/top/tracks?time_range=${time_range}&limit=${limit}`,
  );
}

export function fetchRecentlyPlayed(limit = 50) {
  return getJson<Paged<RecentlyPlayedItem>>(
    `/me/player/recently-played?limit=${limit}`,
  );
}
