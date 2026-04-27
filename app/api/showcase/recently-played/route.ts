import { readOwnerRecentlyFresh } from "@/lib/owner-recently-store";
import {
  spotifyShowcaseFetch,
  withShowcaseCache,
} from "@/lib/spotify-showcase";

const TTL_MS = 5 * 60_000; // 5 minutes — fallback when Blob is empty

type Item = {
  playedAt: string;
  track: {
    name: string;
    uri: string;
    artists: string[];
    image?: string | null;
  };
};

async function load(): Promise<{ items: Item[] }> {
  const res = await spotifyShowcaseFetch("/me/player/recently-played?limit=20");
  if (!res || !res.ok) return { items: [] };
  const data = (await res.json()) as {
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
  return {
    items: (data.items ?? []).map((item) => ({
      playedAt: item.played_at,
      track: {
        name: item.track.name,
        uri: item.track.uri,
        artists: (item.track.artists ?? []).map((a) => a.name),
        image: item.track.album?.images?.[0]?.url ?? null,
      },
    })),
  };
}

export async function GET() {
  // SWR read: returns the Blob immediately if fresh (<5 min old);
  // otherwise refreshes from Spotify (with inflight dedup) before
  // returning. The cron still guarantees daily freshness as a floor.
  const baked = await readOwnerRecentlyFresh();
  if (baked && baked.items.length > 0) {
    return Response.json({ items: baked.items });
  }
  try {
    const payload = await withShowcaseCache("recently-played", TTL_MS, load);
    return Response.json(payload);
  } catch {
    return Response.json({ items: [] }, { status: 200 });
  }
}
