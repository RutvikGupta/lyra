import { hasAuthSession } from "@/lib/spotify";
import { fetchProfile, fetchShowcaseProfile } from "@/lib/spotify-api";

export async function GET() {
  const profile = await fetchProfile();
  if (!profile) {
    // fetchProfile returned null — could be no cookie, revoked token,
    // or Spotify rate-limiting /me. Distinguish via hasAuthSession:
    // if the cookie is still in place, this is a transient failure on
    // an authed user, so don't flip the UI to "logged out". Return
    // 200 with authenticated:true and no fields so the client treats
    // it as "still logged in, data unavailable right now".
    const stillAuthed = await hasAuthSession();
    if (stillAuthed) {
      return Response.json({ authenticated: true });
    }
    return Response.json({ authenticated: false }, { status: 401 });
  }
  // Resolve owner identity from the showcase profile (best-effort —
  // unconfigured installations just don't get an owner flag). The client
  // uses `isOwner` to decide whether to expose owner-only controls like
  // the Refresh Showcase button.
  let ownerId: string | null = null;
  try {
    const owner = await fetchShowcaseProfile();
    ownerId = owner?.id ?? null;
  } catch {
    // ignore — showcase not configured or transient failure
  }
  return Response.json({
    authenticated: true,
    id: profile.id,
    name: profile.display_name,
    image: profile.images?.[0]?.url ?? null,
    profileUrl: profile.external_urls?.spotify ?? null,
    isOwner: !!ownerId && ownerId === profile.id,
  });
}
