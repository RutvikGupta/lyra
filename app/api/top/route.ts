import { hasAuthSession } from "@/lib/spotify";
import {
  enrichArtists,
  fetchShowcaseTopArtists,
  fetchTopArtists,
  fetchTopTracks,
  type SpotifyArtist,
  type TimeRange,
} from "@/lib/spotify-api";
import {
  showcaseConfigured,
  withShowcaseCache,
} from "@/lib/spotify-showcase";

const VALID_RANGES: TimeRange[] = ["short_term", "medium_term", "long_term"];
const SHOWCASE_TTL = 60 * 60_000; // 1h — top artists barely move

type ArtistItem = {
  id: string;
  rank: number;
  name: string;
  genres: string[];
  image: string | null;
  popularity: number;
  listeners: number;
  playcount: number;
  uri: string;
};

function shapeArtists(items: SpotifyArtist[]): ArtistItem[] {
  return items.map((a, rank) => ({
    id: a.id,
    rank: rank + 1,
    name: a.name,
    genres: Array.isArray(a.genres) ? a.genres : [],
    image: a.images?.[0]?.url ?? null,
    popularity: a.popularity ?? 0,
    listeners: a.lastfmListeners ?? 0,
    playcount: a.lastfmPlaycount ?? 0,
    uri: a.uri,
  }));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "artists";
  const rangeParam = searchParams.get("time_range") ?? "long_term";
  const time_range: TimeRange = (
    VALID_RANGES.includes(rangeParam as TimeRange) ? rangeParam : "long_term"
  ) as TimeRange;

  if (type === "artists") {
    const authed = await hasAuthSession();

    if (authed) {
      const data = await fetchTopArtists(time_range, 50);
      if (data) {
        const enriched = await enrichArtists(data.items);
        return Response.json({
          authenticated: true,
          source: "personal",
          items: shapeArtists(enriched),
        });
      }
      // Authed but Spotify failed — could be revoked refresh token,
      // post-OAuth lag, or rate-limiting on /me/top/artists. The earlier
      // design returned 503 here so Starfield could retry with backoff,
      // but a sustained 429 just exhausts the retry budget and surfaces
      // "Failed (503)" on the constellation. Fall through to the
      // showcase branch instead so the user sees kivtur00's graph
      // rather than a hard error wall. The brief post-OAuth race window
      // (showing showcase data for 1–2s before the user's data arrives
      // on a refetch) is a fair trade for never failing hard.
    }

    if (!showcaseConfigured()) {
      return Response.json({
        authenticated: false,
        source: "personal",
        items: [],
      });
    }

    try {
      const items = await withShowcaseCache(
        `top-artists:${time_range}`,
        SHOWCASE_TTL,
        async () => {
          const sd = await fetchShowcaseTopArtists(time_range, 50);
          if (!sd) return [];
          const enriched = await enrichArtists(sd.items);
          return shapeArtists(enriched);
        },
      );
      return Response.json({
        authenticated: false,
        source: "showcase",
        items,
      });
    } catch {
      return Response.json({
        authenticated: false,
        source: "showcase",
        items: [],
      });
    }
  }

  if (type === "tracks") {
    const data = await fetchTopTracks(time_range, 50);
    if (!data) {
      return Response.json({ authenticated: false }, { status: 401 });
    }
    return Response.json({
      authenticated: true,
      items: data.items.map((t, rank) => ({
        id: t.id,
        rank: rank + 1,
        name: t.name,
        uri: t.uri,
        artists: (t.artists ?? []).map((a) => ({ id: a.id, name: a.name })),
        image: t.album?.images?.[0]?.url ?? null,
        popularity: t.popularity ?? 0,
      })),
    });
  }

  return Response.json({ error: "invalid type" }, { status: 400 });
}
