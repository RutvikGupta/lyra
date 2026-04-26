import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  generateChallenge,
  generateState,
  generateVerifier,
} from "@/lib/pkce";
import {
  SCOPES,
  SPOTIFY_AUTH_URL,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
  STATE_COOKIE,
  VERIFIER_COOKIE,
} from "@/lib/spotify";

export async function GET() {
  const state = generateState();

  const store = await cookies();
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
  };
  store.set(STATE_COOKIE, state, opts);

  const url = new URL(SPOTIFY_AUTH_URL);
  url.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", SPOTIFY_REDIRECT_URI);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES);

  // Spotify rotates refresh tokens issued via PKCE. With a client secret
  // configured, run plain Authorization Code flow instead — refresh
  // tokens are long-lived (no rotation), so SHOWCASE_REFRESH_TOKEN stays
  // valid across server restarts and Vercel cold starts.
  if (!SPOTIFY_CLIENT_SECRET) {
    const verifier = generateVerifier();
    const challenge = generateChallenge(verifier);
    store.set(VERIFIER_COOKIE, verifier, opts);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("code_challenge", challenge);
  }

  return NextResponse.redirect(url);
}
