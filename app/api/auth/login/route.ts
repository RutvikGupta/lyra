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
  SPOTIFY_REDIRECT_URI,
  STATE_COOKIE,
  VERIFIER_COOKIE,
} from "@/lib/spotify";

export async function GET() {
  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = generateState();

  const store = await cookies();
  const opts = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10,
  };
  store.set(VERIFIER_COOKIE, verifier, opts);
  store.set(STATE_COOKIE, state, opts);

  const url = new URL(SPOTIFY_AUTH_URL);
  url.searchParams.set("client_id", SPOTIFY_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", SPOTIFY_REDIRECT_URI);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", SCOPES);

  return NextResponse.redirect(url);
}
