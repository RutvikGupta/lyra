import { fetchProfile } from "@/lib/spotify-api";

export async function GET() {
  const profile = await fetchProfile();
  if (!profile) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  return Response.json({
    authenticated: true,
    name: profile.display_name,
    image: profile.images?.[0]?.url ?? null,
    profileUrl: profile.external_urls?.spotify ?? null,
  });
}
