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
      // Authed but the call failed. Two distinct causes:
      //   (a) refresh token was revoked / Spotify said invalid_grant —
      //       getAccessToken already cleared the cookie, so hasAuthSession
      //       now returns false. Fall through to the showcase path so the
      //       user gets *something* instead of a 503 wall.
      //   (b) genuinely transient (post-OAuth lag, Spotify outage) — the
      //       cookie is still in place. Surface 503 so the client retries
      //       with backoff and we don't briefly serve showcase data to a
      //       user whose own data will arrive any second.
      const stillAuthed = await hasAuthSession();
      if (stillAuthed) {
        return Response.json(
          {
            authenticated: true,
            source: "personal",
            items: [],
            retrying: true,
          },
          { status: 503 },
        );
      }
      // Cookie was cleared mid-request → flow into the showcase branch.
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
