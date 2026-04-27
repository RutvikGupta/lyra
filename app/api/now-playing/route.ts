import { cookies } from "next/headers";
import {
  hasAuthSession,
  isRateLimitedFor,
  REFRESH_COOKIE,
  spotifyFetch,
} from "@/lib/spotify";

type SpotifyArtist = { name: string; uri: string };
type SpotifyImage = { url: string; width: number; height: number };
type SpotifyCurrentlyPlaying = {
  is_playing: boolean;
  progress_ms: number;
  item: {
    type?: string;
    name: string;
    uri: string;
    duration_ms: number;
    album: { name: string; images: SpotifyImage[] };
    artists: SpotifyArtist[];
  } | null;
};

function shape(
  data: SpotifyCurrentlyPlaying | null,
  source: "personal" | "showcase",
  authenticated: boolean,
) {
  if (!data?.item) {
    return { authenticated, source, isPlaying: false };
  }
  return {
    authenticated,
    source,
    isPlaying: !!data.is_playing,
    progressMs: data.progress_ms,
    track: {
      name: data.item.name,
      uri: data.item.uri,
      durationMs: data.item.duration_ms,
      album: {
        name: data.item.album?.name,
        image: data.item.album?.images?.[0]?.url,
      },
      artists: (data.item.artists ?? []).map((a) => ({
        name: a.name,
        uri: a.uri,
      })),
    },
  };
}

export async function GET() {
  const authed = await hasAuthSession();

  // Personal session first — the owner gets their own data when signed in.
  if (authed) {
    const res = await spotifyFetch("/me/player/currently-playing");
    if (res?.status === 204) {
      return Response.json({
        authenticated: true,
        source: "personal",
        isPlaying: false,
      });
    }
    if (res?.ok) {
      const data = (await res.json()) as SpotifyCurrentlyPlaying;
      return Response.json(shape(data, "personal", true));
    }
    // Authed but Spotify failed. Return empty + rateLimited:true.
    // The client preserves the previous in-memory track during the
    // throttle window (NowPlaying.tsx + Starfield's halo). Cookie
    // cleared → fall through to unauthed showcase branch.
    const stillAuthed = await hasAuthSession();
    if (stillAuthed) {
      const store = await cookies();
      const refresh = store.get(REFRESH_COOKIE)?.value ?? "";
      const rateLimited = !!refresh && isRateLimitedFor(refresh);
      return Response.json({
        authenticated: true,
        source: "personal",
        isPlaying: false,
        rateLimited,
      });
    }
    // Cookie was cleared → flow into the showcase branch below.
  }

  // Unauthenticated visitors used to see the owner's currently-playing
  // track ("showcase now-playing"). That was removed: it surfaced the
  // owner's listening to anyone who landed on the page (privacy), and
  // it burned the showcase token's rate-limit budget on something
  // visitors didn't ask for. Now-playing is owner-only.
  return Response.json({
    authenticated: false,
    source: "personal",
    isPlaying: false,
  });
}
