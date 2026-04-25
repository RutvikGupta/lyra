import { fetchLastfmArtistData } from "@/lib/spotify-api";

type IncomingArtist = {
  name: string;
  playCount: number;
  msPlayed: number;
  trackCount: number;
};

type EnrichedItem = {
  id: string;
  rank: number;
  name: string;
  genres: string[];
  image: string | null;
  popularity: number;
  listeners: number;
  playcount: number;
  uri: string;
  // Library-specific extras for the detail panel
  myPlayCount: number;
  myMsPlayed: number;
  myTrackCount: number;
};

export async function POST(req: Request) {
  let body: { artists?: IncomingArtist[] } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const artists = (body.artists ?? []).filter((a) => a?.name);
  if (artists.length === 0) {
    return Response.json({ items: [] });
  }

  // 5 artists × 2 Last.fm calls = 10 concurrent reqs per batch.
  const CHUNK = 5;
  const enriched: EnrichedItem[] = [];

  for (let i = 0; i < artists.length; i += CHUNK) {
    const chunk = artists.slice(i, i + CHUNK);
    const results = await Promise.all(
      chunk.map(async (a, idx) => {
        const data = await fetchLastfmArtistData(a.name);
        return {
          id: `lib:${a.name.toLowerCase()}`,
          rank: i + idx + 1,
          name: a.name,
          genres: data.genres,
          image: null,
          popularity: 0,
          listeners: data.listeners,
          playcount: data.playcount,
          uri: "",
          myPlayCount: a.playCount,
          myMsPlayed: a.msPlayed,
          myTrackCount: a.trackCount,
        };
      }),
    );
    enriched.push(...results);
  }

  let withGenres = 0;
  for (const e of enriched) if (e.genres.length > 0) withGenres++;
  console.log(
    `[lib-enrich] ${enriched.length} library artists, ${withGenres} with genres`,
  );

  return Response.json({ items: enriched });
}
