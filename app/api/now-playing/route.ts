import { cookies } from "next/headers";
import {
  hasAuthSession,
  isRateLimitedFor,
  REFRESH_COOKIE,
  spotifyFetch,
} from "@/lib/spotify";
import {
  showcaseConfigured,
  spotifyShowcaseFetch,
  withShowcaseCache,
} from "@/lib/spotify-showcase";

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

// Tiny TTL — just enough to dedupe concurrent visitor polls within the
// same second. Anything longer and song changes feel laggy. ~1 Spotify
// call/sec when watched, well under their unauthed rate limit.
const SHOWCASE_TTL = 1_000;

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
    // Authed but Spotify failed. Two cases:
    //   (a) refresh token revoked → getAccessToken cleared the cookie →
    //       hasAuthSession is now false. Fall through to showcase so the
    //       visitor sees something instead of an empty card forever.
    //   (b) genuine transient (post-OAuth lag, Spotify rate-limit on /me).
    //       Return 200 with isPlaying:false — the client polls every ~2s
    //       and gets fresh data on the next tick. Returning 503 on a
    //       polled endpoint floods devtools without any UX upside; the
    //       "no track playing" state is a natural empty render.
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

  // No session. Serve the owner's showcase track so visitors see something
  // instead of an empty card.
  if (!showcaseConfigured()) {
    return Response.json({
      authenticated: false,
      source: "personal",
      isPlaying: false,
    });
  }

  try {
    const payload = await withShowcaseCache(
      "now-playing",
      SHOWCASE_TTL,
      async () => {
        const r = await spotifyShowcaseFetch("/me/player/currently-playing");
        if (!r || r.status === 204 || !r.ok) return null;
        return (await r.json()) as SpotifyCurrentlyPlaying;
      },
    );
    return Response.json(shape(payload, "showcase", false));
  } catch {
    return Response.json({
      authenticated: false,
      source: "showcase",
      isPlaying: false,
    });
  }
}
