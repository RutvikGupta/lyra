import { cookies } from "next/headers";

export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
// Optional. When set, OAuth runs as a confidential client (Basic auth on
// /api/token). PKCE still protects the redirect leg, but adding the secret
// makes Spotify treat the client as confidential, which means refresh
// tokens issued via this flow are long-lived and DO NOT rotate on every
// refresh — critical for showcase mode surviving server restarts and
// Vercel cold starts.
export const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET ?? "";
export const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI!;
export const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

// Build the token-endpoint auth headers + body fields. With a client
// secret we use HTTP Basic; without it (PKCE-only) the client_id goes in
// the body. Same shape works for both authorization_code exchange and
// refresh_token grants.
export function tokenAuth(): {
  headers: Record<string, string>;
  bodyClientId: Record<string, string>;
} {
  if (SPOTIFY_CLIENT_SECRET) {
    const basic = Buffer.from(
      `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`,
    ).toString("base64");
    return {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      bodyClientId: {},
    };
  }
  return {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    bodyClientId: { client_id: SPOTIFY_CLIENT_ID },
  };
}

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

export type RefreshResult =
  | { kind: "ok"; tokens: SpotifyTokens }
  | { kind: "invalid"; reason: string } // refresh token permanently invalid (revoked/expired)
  | { kind: "transient" }; // network/5xx — caller may retry later

export async function refreshAccessToken(
  refreshToken: string,
): Promise<RefreshResult> {
  const auth = tokenAuth();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    ...auth.bodyClientId,
  });
  let res: Response;
  try {
    res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: auth.headers,
      body,
      cache: "no-store",
    });
  } catch {
    return { kind: "transient" };
  }
  if (res.ok) {
    return { kind: "ok", tokens: (await res.json()) as SpotifyTokens };
  }
  // 429 is rate-limiting, not a permanent token failure — never clear
  // cookies / env vars in this case. Spotify's Retry-After applies; the
  // caller's cooldown logic will handle the wait.
  if (res.status === 429) {
    return { kind: "transient" };
  }
  // For other 4xx, only treat as truly invalid when Spotify explicitly
  // says so via `error: invalid_grant | invalid_client | invalid_request`.
  // Spotify's token endpoint occasionally returns generic 4xx under load
  // for tokens that are still valid — clearing the cookie there logs the
  // user out unnecessarily. Be conservative: if we can't parse the body
  // or the error code isn't one of the fatal ones, treat as transient.
  if (res.status >= 400 && res.status < 500) {
    let reason: string | null = null;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body?.error === "string") reason = body.error;
    } catch {
      // body wasn't JSON — treat as transient (don't nuke the cookie).
    }
    const fatal =
      reason === "invalid_grant" ||
      reason === "invalid_client" ||
      reason === "invalid_request";
    if (fatal) {
      console.warn(`[spotify] token refresh fatal: ${reason} (${res.status})`);
      return { kind: "invalid", reason: reason! };
    }
    console.warn(
      `[spotify] token refresh ${res.status} (error=${reason ?? "<no body>"}) — treating as transient`,
    );
    return { kind: "transient" };
  }
  return { kind: "transient" };
}

// In-memory access token cache, keyed by refresh token.
// Spotify access tokens live ~1hr; we re-use until ~30s before expiry.
// Halves API calls vs. refreshing on every request.
type CachedToken = { accessToken: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();
// Singleflight per refresh token: when multiple concurrent requests need
// to refresh the same token, they all await the same network call.
// Without this, two requests can race the rotation and the second hits
// invalid_grant on an already-rotated token.
const inflightRefreshes = new Map<string, Promise<string | null>>();

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  const refresh = store.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;

  const now = Date.now();
  const cached = tokenCache.get(refresh);
  if (cached && cached.expiresAt > now + 30_000) {
    return cached.accessToken;
  }

  const existing = inflightRefreshes.get(refresh);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    const result = await refreshAccessToken(refresh);
    if (result.kind === "invalid") {
      // Spotify says the refresh token is permanently dead (revoked, app
      // unauthorized, etc.). Drop the cookie so subsequent requests
      // behave as unauthenticated and fall back to showcase data instead
      // of looping on 503.
      console.warn(
        `[auth] clearing refresh cookie — Spotify rejected token (${result.reason})`,
      );
      tokenCache.delete(refresh);
      try {
        store.delete(REFRESH_COOKIE);
      } catch {
        // cookies().delete() can throw in read-only contexts (e.g.
        // Server Components without a response). Ignore — the next
        // route handler will retry and clear it where it can.
      }
      return null;
    }
    if (result.kind === "transient") return null;

    const tokens = result.tokens;
    const expiresAt = Date.now() + tokens.expires_in * 1000;

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
  })().finally(() => {
    inflightRefreshes.delete(refresh);
  });

  inflightRefreshes.set(refresh, promise);
  return promise;
}

// Cheap check for "has the visitor connected at least once" — peek at the
// refresh cookie without doing a token exchange. Used by route handlers to
// decide whether a failed personal fetch should fall back to showcase data
// (no cookie → fall back) or surface the error (cookie present → don't
// silently swap them onto someone else's data).
export async function hasAuthSession(): Promise<boolean> {
  const store = await cookies();
  const value = store.get(REFRESH_COOKIE)?.value;
  // Diagnostic: surface whether the cookie is actually visible to
  // server-side reads. Combined with the [auth] callback success log,
  // this lets us tell from Vercel logs whether (a) the cookie was set
  // but the browser's not sending it, (b) it's being sent but cookies()
  // isn't returning it, or (c) the home page render is happening before
  // the cookie was set.
  console.log(
    `[auth] hasAuthSession check — cookie ${value ? `present (len=${value.length})` : "MISSING"}`,
  );
  return !!value;
}

// Cooldown map keyed by refresh token. When Spotify returns 429 with a
// Retry-After header, we record the absolute time at which it's safe to
// resume calls for that user. Subsequent calls during the window
// short-circuit to null instead of hammering Spotify (and earning more
// 429s, which can extend the window further).
const cooldownByRefresh = new Map<string, number>();

export function isRateLimitedFor(refresh: string): boolean {
  const until = cooldownByRefresh.get(refresh);
  if (!until) return false;
  if (until <= Date.now()) {
    cooldownByRefresh.delete(refresh);
    return false;
  }
  return true;
}

function recordRateLimit(refresh: string, retryAfterSec: number) {
  // Clamp to [1, 600] — Spotify rarely sends > a few minutes, but cap to
  // avoid a malformed header pinning us out for hours.
  const clamped = Math.max(1, Math.min(600, retryAfterSec || 30));
  cooldownByRefresh.set(refresh, Date.now() + clamped * 1000);
  console.warn(
    `[spotify] 429 — backing off for ${clamped}s before next call for this user`,
  );
}

export async function spotifyFetch(
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  const store = await cookies();
  const refresh = store.get(REFRESH_COOKIE)?.value;
  if (refresh && isRateLimitedFor(refresh)) {
    return null;
  }
  const token = await getAccessToken();
  if (!token) return null;
  const res = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
  if (res.status === 429 && refresh) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    recordRateLimit(refresh, Number.isFinite(retryAfter) ? retryAfter : 30);
  }
  return res;
}
