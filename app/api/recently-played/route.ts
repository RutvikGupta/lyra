import { fetchRecentlyPlayed } from "@/lib/spotify-api";

export async function GET() {
  const data = await fetchRecentlyPlayed(20);
  if (!data) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  return Response.json({
    authenticated: true,
    items: (data.items ?? [])
      .filter((item) => item?.track)
      .map((item) => ({
        playedAt: item.played_at,
        track: {
          name: item.track.name,
          uri: item.track.uri,
          artists: (item.track.artists ?? []).map((a) => a.name),
          image:
            item.track.album?.images?.[2]?.url ??
            item.track.album?.images?.[0]?.url ??
            null,
        },
      })),
  });
}
