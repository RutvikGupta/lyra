import { cookies } from "next/headers";
import { hasAuthSession, isRateLimitedFor, REFRESH_COOKIE } from "@/lib/spotify";
import {
  enrichArtists,
  fetchShowcaseTopArtists,
  fetchTopArtists,
  fetchTopTracks,
  type SpotifyArtist,
  type TimeRange,
} from "@/lib/spotify-api";
import { readOwnerTop } from "@/lib/owner-top-store";
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
      // Authed but Spotify failed. Return an empty personal response
      // with rateLimited:true. The client caches the user's last-good
      // data in localStorage and renders that during the throttle
      // window, so we never serve someone else's data to a logged-in
      // user. Cookie just cleared → fall through to unauthed branch.
      const stillAuthed = await hasAuthSession();
      if (stillAuthed) {
        const store = await cookies();
        const refresh = store.get(REFRESH_COOKIE)?.value ?? "";
        const rateLimited = !!refresh && isRateLimitedFor(refresh);
        return Response.json({
          authenticated: true,
          source: "personal",
          items: [],
          rateLimited,
        });
      }
    }

    // Prefer the weekly-baked Blob snapshot — visitor traffic never
    // hits Spotify when this is populated. See lib/owner-top-store.ts.
    const baked = await readOwnerTop();
    if (baked && baked.artists[time_range]?.length) {
      return Response.json({
        authenticated: false,
        source: "showcase",
        items: baked.artists[time_range],
      });
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
