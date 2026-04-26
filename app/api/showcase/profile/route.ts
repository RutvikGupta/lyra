import { fetchShowcaseProfile } from "@/lib/spotify-api";
import { withShowcaseCache } from "@/lib/spotify-showcase";

const TTL_MS = 24 * 60 * 60_000; // 24h — display name + avatar barely change

export async function GET() {
  try {
    const profile = await withShowcaseCache("profile", TTL_MS, async () => {
      const data = await fetchShowcaseProfile();
      if (!data) return null;
      return {
        id: data.id,
        displayName: data.display_name,
        image: data.images?.[0]?.url ?? null,
      };
    });
    if (!profile) return Response.json({ profile: null });
    return Response.json({ profile });
  } catch {
    return Response.json({ profile: null });
  }
}
