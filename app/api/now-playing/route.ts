import { spotifyFetch } from "@/lib/spotify";

type SpotifyArtist = { name: string; uri: string };
type SpotifyImage = { url: string; width: number; height: number };
type SpotifyCurrentlyPlaying = {
  is_playing: boolean;
  progress_ms: number;
  item: {
    name: string;
    uri: string;
    duration_ms: number;
    album: { name: string; images: SpotifyImage[] };
    artists: SpotifyArtist[];
  } | null;
};

export async function GET() {
  const res = await spotifyFetch("/me/player/currently-playing");
  if (!res) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  if (res.status === 204) {
    return Response.json({ authenticated: true, isPlaying: false });
  }
  if (!res.ok) {
    return Response.json(
      { authenticated: true, error: res.statusText },
      { status: res.status },
    );
  }

  const data = (await res.json()) as SpotifyCurrentlyPlaying;
  if (!data?.item) {
    return Response.json({ authenticated: true, isPlaying: false });
  }

  return Response.json({
    authenticated: true,
    isPlaying: data.is_playing,
    track: {
      name: data.item.name,
      uri: data.item.uri,
      durationMs: data.item.duration_ms,
      progressMs: data.progress_ms,
      album: {
        name: data.item.album?.name,
        image: data.item.album?.images?.[0]?.url,
      },
      artists: data.item.artists.map((a) => ({ name: a.name, uri: a.uri })),
    },
  });
}
