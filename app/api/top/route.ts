import {
  enrichArtists,
  fetchTopArtists,
  fetchTopTracks,
  type TimeRange,
} from "@/lib/spotify-api";

const VALID_RANGES: TimeRange[] = ["short_term", "medium_term", "long_term"];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "artists";
  const rangeParam = searchParams.get("time_range") ?? "long_term";
  const time_range: TimeRange = (
    VALID_RANGES.includes(rangeParam as TimeRange) ? rangeParam : "long_term"
  ) as TimeRange;

  if (type === "artists") {
    const data = await fetchTopArtists(time_range, 50);
    if (!data) {
      return Response.json({ authenticated: false }, { status: 401 });
    }
    const enriched = await enrichArtists(data.items);
    return Response.json({
      authenticated: true,
      items: enriched.map((a, rank) => ({
        id: a.id,
        rank: rank + 1,
        name: a.name,
        genres: Array.isArray(a.genres) ? a.genres : [],
        image: a.images?.[0]?.url ?? null,
        popularity: a.popularity ?? 0,
        listeners: a.lastfmListeners ?? 0,
        playcount: a.lastfmPlaycount ?? 0,
        uri: a.uri,
      })),
    });
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
