import { cookies } from "next/headers";

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
export const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI!;
export const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

export const SCOPES = [
  "user-read-currently-playing",
  "user-read-playback-state",
  "user-read-recently-played",
  "user-top-read",
  "user-read-private",
].join(" ");

export const REFRESH_COOKIE = "spotify_refresh";
export const VERIFIER_COOKIE = "spotify_verifier";
export const STATE_COOKIE = "spotify_state";

const REFRESH_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365,
};

export type SpotifyTokens = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export async function refreshAccessToken(
  refreshToken: string,
): Promise<SpotifyTokens | null> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: SPOTIFY_CLIENT_ID,
  });
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

// In-memory access token cache, keyed by refresh token.
// Spotify access tokens live ~1hr; we re-use until ~30s before expiry.
// Halves API calls vs. refreshing on every request.
type CachedToken = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  const refresh = store.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;

  const now = Date.now();
  const cached = tokenCache.get(refresh);
  if (cached && cached.expiresAt > now + 30_000) {
    return cached.accessToken;
  }

  const tokens = await refreshAccessToken(refresh);
  if (!tokens) return null;

  const expiresAt = now + tokens.expires_in * 1000;

  if (tokens.refresh_token && tokens.refresh_token !== refresh) {
    tokenCache.delete(refresh);
    tokenCache.set(tokens.refresh_token, {
      accessToken: tokens.access_token,
      expiresAt,
    });
    store.set(REFRESH_COOKIE, tokens.refresh_token, REFRESH_COOKIE_OPTS);
  } else {
    tokenCache.set(refresh, {
      accessToken: tokens.access_token,
      expiresAt,
    });
  }

  return tokens.access_token;
}

export async function spotifyFetch(
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  const token = await getAccessToken();
  if (!token) return null;
  return fetch(`${SPOTIFY_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
}
