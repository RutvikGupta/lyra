import {
  enrichArtists,
  fetchShowcaseTopArtists,
  type TimeRange,
} from "@/lib/spotify-api";
import { withShowcaseCache } from "@/lib/spotify-showcase";

const VALID_RANGES: TimeRange[] = ["short_term", "medium_term", "long_term"];
const TTL_MS = 60 * 60_000; // 1 hour — top artists barely move on this scale

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rangeParam = searchParams.get("time_range") ?? "long_term";
  const time_range: TimeRange = (
    VALID_RANGES.includes(rangeParam as TimeRange) ? rangeParam : "long_term"
  ) as TimeRange;

  try {
    const items = await withShowcaseCache(
      `top-artists:${time_range}`,
      TTL_MS,
      async () => {
        const data = await fetchShowcaseTopArtists(time_range, 50);
        if (!data) return [];
        const enriched = await enrichArtists(data.items);
        return enriched.map((a, rank) => ({
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
      },
    );
    return Response.json({ items });
  } catch {
    return Response.json({ items: [] });
  }
}
