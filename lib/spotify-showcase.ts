import { SPOTIFY_API_BASE, refreshAccessToken } from "./spotify";

// Showcase mode — server-side, refresh-token-based access for the site
// owner's account (kivtur00). Lets the public landing page render their
// listening history without requiring the visitor to log in.
//
// The refresh token comes from SHOWCASE_REFRESH_TOKEN — set it once after
// running the regular OAuth flow against your own account (the value is
// the cookie `spotify_refresh` that the callback wrote).
//
// Spotify can rotate refresh tokens; if it returns a new one we keep
// rolling forward in memory so a single rotated token doesn't break the
// process for the rest of the instance lifetime. (Across deploys, you'd
// have to re-set the env var if Spotify rotates.)

// Persist module-scope state on globalThis to survive Turbopack/HMR
// reloads in dev. Without this, each recompile re-runs this module and
// resets `liveRefreshToken` / `envTokenInvalid`, which can cause:
//   - the rotated in-memory token getting forgotten between requests
//   - the latch firing on a token that was already rotated by a prior
//     module instance
type ShowcaseState = {
  liveRefreshToken: string | null;
  cachedAccess: { token: string; expiresAt: number } | null;
  envTokenInvalid: boolean;
  inflightRefresh: Promise<string | null> | null;
};

const g = globalThis as unknown as { __lyraShowcase?: ShowcaseState };
if (!g.__lyraShowcase) {
  g.__lyraShowcase = {
    liveRefreshToken: null,
    cachedAccess: null,
    envTokenInvalid: false,
    inflightRefresh: null,
  };
}
const state = g.__lyraShowcase;

function getInitialRefreshToken(): string | null {
  return process.env.SHOWCASE_REFRESH_TOKEN ?? null;
}

export function showcaseConfigured(): boolean {
  return !!getInitialRefreshToken() && !state.envTokenInvalid;
}

async function doRefresh(): Promise<string | null> {
  const refresh = state.liveRefreshToken ?? getInitialRefreshToken();
  if (!refresh) return null;

  const result = await refreshAccessToken(refresh);
  if (result.kind === "invalid") {
    const onLiveToken =
      !!state.liveRefreshToken && refresh === state.liveRefreshToken;
    state.envTokenInvalid = true;
    state.cachedAccess = null;
    state.liveRefreshToken = null;
    console.error(
      `[showcase] refresh token rejected by Spotify (${result.reason}, ` +
        `was ${onLiveToken ? "rotated in-memory" : "env var"}). ` +
        `Update SHOWCASE_REFRESH_TOKEN and restart.`,
    );
    return null;
  }
  if (result.kind === "transient") return null;

  const tokens = result.tokens;
  state.cachedAccess = {
    token: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  if (tokens.refresh_token && tokens.refresh_token !== refresh) {
    state.liveRefreshToken = tokens.refresh_token;
  } else if (!state.liveRefreshToken) {
    state.liveRefreshToken = refresh;
  }
  return tokens.access_token;
}

export async function getShowcaseAccessToken(): Promise<string | null> {
  if (state.envTokenInvalid) return null;
  if (!getInitialRefreshToken() && !state.liveRefreshToken) return null;

  // Re-use a still-valid access token (with 30s headroom).
  const now = Date.now();
  if (state.cachedAccess && state.cachedAccess.expiresAt > now + 30_000) {
    return state.cachedAccess.token;
  }

  // Coalesce concurrent refreshes — the second caller awaits the same
  // network call rather than triggering its own rotation race.
  if (!state.inflightRefresh) {
    const promise = doRefresh().finally(() => {
      state.inflightRefresh = null;
    });
    state.inflightRefresh = promise;
  }
  return state.inflightRefresh;
}

export async function spotifyShowcaseFetch(
  path: string,
  init?: RequestInit,
): Promise<Response | null> {
  const token = await getShowcaseAccessToken();
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

// Tiny in-memory response cache. Module-scope so Fluid Compute reuses the
// cache across requests on the same instance. A cron route warms this
// every hour; visitor traffic uses whatever's in memory.
type Entry<T> = { data: T; expiresAt: number };
const responseCache = new Map<string, Entry<unknown>>();

export async function withShowcaseCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = responseCache.get(key) as Entry<T> | undefined;
  if (cached && cached.expiresAt > now) return cached.data;
  const data = await loader();
  responseCache.set(key, { data, expiresAt: now + ttlMs });
  return data;
}

export function invalidateShowcaseCache(key?: string) {
  if (key) responseCache.delete(key);
  else responseCache.clear();
}
