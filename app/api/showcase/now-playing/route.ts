import {
  spotifyShowcaseFetch,
  withShowcaseCache,
} from "@/lib/spotify-showcase";

// Public showcase route — no auth required. Serves the site owner's
// currently-playing track. Module-scope cache (15s) protects Spotify
// from being hammered by visitors.
// Tiny TTL — just enough to dedupe concurrent visitor polls. Both the
// /api/now-playing fallback path and this direct route read the same
// cache key, so song changes propagate to all viewers within ~1s.
const TTL_MS = 1_000;

type Track = {
  name: string;
  uri: string;
  artists: { name: string; uri: string }[];
  album?: { name: string; image?: string };
  durationMs?: number;
};

type Payload = {
  isPlaying: boolean;
  progressMs?: number;
  track?: Track;
};

async function load(): Promise<Payload> {
  const res = await spotifyShowcaseFetch("/me/player/currently-playing");
  if (!res || res.status === 204 || !res.ok) {
    return { isPlaying: false };
  }
  const data = (await res.json()) as {
    is_playing?: boolean;
    progress_ms?: number;
    item?: {
      type?: string;
      name?: string;
      uri?: string;
      duration_ms?: number;
      artists?: { name: string; uri: string }[];
      album?: { name: string; images?: { url: string }[] };
    };
  };
  if (!data?.item || data.item.type !== "track") {
    return { isPlaying: false };
  }
  return {
    isPlaying: !!data.is_playing,
    progressMs: data.progress_ms,
    track: {
      name: data.item.name ?? "",
      uri: data.item.uri ?? "",
      durationMs: data.item.duration_ms,
      artists: (data.item.artists ?? []).map((a) => ({
        name: a.name,
        uri: a.uri,
      })),
      album: {
        name: data.item.album?.name ?? "",
        image: data.item.album?.images?.[0]?.url,
      },
    },
  };
}

export async function GET() {
  try {
    const payload = await withShowcaseCache("now-playing", TTL_MS, load);
    return Response.json(payload);
  } catch {
    return Response.json({ isPlaying: false }, { status: 200 });
  }
}
