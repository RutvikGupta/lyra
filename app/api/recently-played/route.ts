import { cookies } from "next/headers";
import {
  hasAuthSession,
  isRateLimitedFor,
  REFRESH_COOKIE,
} from "@/lib/spotify";
import { readOwnerRecentlyFresh } from "@/lib/owner-recently-store";
import { fetchRecentlyPlayed } from "@/lib/spotify-api";
import {
  showcaseConfigured,
  spotifyShowcaseFetch,
  withShowcaseCache,
} from "@/lib/spotify-showcase";

const SHOWCASE_TTL = 5 * 60_000; // 5 minutes

type Raw = {
  items?: {
    played_at: string;
    track: {
      name: string;
      uri: string;
      artists?: { name: string }[];
      album?: { images?: { url: string }[] };
    };
  }[];
};

function shape(
  data: Raw | null,
  source: "personal" | "showcase",
  authenticated: boolean,
) {
  return {
    authenticated,
    source,
    items: (data?.items ?? [])
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
  };
}

export async function GET() {
  const authed = await hasAuthSession();

  if (authed) {
    const data = await fetchRecentlyPlayed(20);
    if (data) {
      return Response.json(shape(data as Raw, "personal", true));
    }
    // Authed but Spotify failed. Return empty + rateLimited:true.
    // The client caches the user's last-good response in localStorage
    // and renders that during the throttle window — never serves
    // someone else's data to a logged-in user.
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
    // Cookie cleared → flow into the showcase branch below.
  }

  // SWR read: returns the Blob immediately if fresh; otherwise
  // refreshes from Spotify (with inflight dedup) before returning.
  // Mirrors /api/showcase/recently-played.
  const baked = await readOwnerRecentlyFresh();
  if (baked && baked.items.length > 0) {
    return Response.json({
      authenticated: false,
      source: "showcase",
      items: baked.items,
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
    const payload = await withShowcaseCache<Raw | null>(
      "recently-played-raw",
      SHOWCASE_TTL,
      async () => {
        const r = await spotifyShowcaseFetch(
          "/me/player/recently-played?limit=20",
        );
        if (!r || !r.ok) return null;
        return (await r.json()) as Raw;
      },
    );
    return Response.json(shape(payload, "showcase", false));
  } catch {
    return Response.json({
      authenticated: false,
      source: "showcase",
      items: [],
    });
  }
}
