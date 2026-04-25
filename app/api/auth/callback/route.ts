import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  REFRESH_COOKIE,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_TOKEN_URL,
  STATE_COOKIE,
  VERIFIER_COOKIE,
} from "@/lib/spotify";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const store = await cookies();
  const verifier = store.get(VERIFIER_COOKIE)?.value;
  const expectedState = store.get(STATE_COOKIE)?.value;
  store.delete(VERIFIER_COOKIE);
  store.delete(STATE_COOKIE);

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, req.url),
    );
  }
  if (!code || !verifier || !state || state !== expectedState) {
    return NextResponse.redirect(new URL(`/?error=invalid_callback`, req.url));
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: SPOTIFY_CLIENT_ID,
    code_verifier: verifier,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(text.slice(0, 200))}`, req.url),
    );
  }

  const tokens = (await res.json()) as { refresh_token: string };
  store.set(REFRESH_COOKIE, tokens.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.redirect(new URL("/", req.url));
}
