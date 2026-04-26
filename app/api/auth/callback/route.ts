import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  REFRESH_COOKIE,
  SPOTIFY_API_BASE,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_TOKEN_URL,
  STATE_COOKIE,
  VERIFIER_COOKIE,
  tokenAuth,
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
  // PKCE branch needs the verifier; plain (confidential) flow doesn't.
  const usingPkce = !SPOTIFY_CLIENT_SECRET;
  if (
    !code ||
    !state ||
    state !== expectedState ||
    (usingPkce && !verifier)
  ) {
    return NextResponse.redirect(new URL(`/?error=invalid_callback`, req.url));
  }

  const auth = tokenAuth();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    ...(usingPkce && verifier ? { code_verifier: verifier } : {}),
    ...auth.bodyClientId,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: auth.headers,
    body,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(text.slice(0, 200))}`, req.url),
    );
  }

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token: string;
  };

  // Verify the access token actually works against the Spotify API before
  // committing the refresh cookie + redirecting. Catches cases where the
  // token exchange "succeeded" but the user account isn't on the dev-mode
  // allowlist (Spotify returns valid tokens but every API call 403s).
  //
  // Spotify's token issuance + CDN propagation has a small lag (200-500ms),
  // so we retry transient failures up to 4 times with backoff before
  // declaring the connection broken.
  const verifyResult = await verifyToken(tokens.access_token);
  if (!verifyResult.ok) {
    const status = verifyResult.status;
    const reason =
      status === 403
        ? "not_on_allowlist"
        : status === 401
          ? "token_invalid"
          : `verify_${status}`;
    return NextResponse.redirect(new URL(`/?error=${reason}`, req.url));
  }

  store.set(REFRESH_COOKIE, tokens.refresh_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.redirect(new URL("/", req.url));
}

async function verifyToken(
  accessToken: string,
): Promise<{ ok: boolean; status: number }> {
  // Backoff schedule: 0, 250, 500, 1000ms — tolerates Spotify's typical
  // post-issuance propagation lag without delaying success in the common
  // case where the first call works.
  const delays = [0, 250, 500, 1000];
  let lastStatus = 0;
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(`${SPOTIFY_API_BASE}/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (res.ok) return { ok: true, status: res.status };
      lastStatus = res.status;
      // 401/403/429 are deterministic on this short timescale — no point
      // burning the retry budget. 429 in particular comes with a
      // Retry-After header in seconds; sub-second backoff won't clear it.
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        return { ok: false, status: res.status };
      }
    } catch {
      // Network blip — retry.
    }
  }
  return { ok: false, status: lastStatus };
}
