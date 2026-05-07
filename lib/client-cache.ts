// localStorage-backed cache with TTL. Used by client components that
// fetch user-specific data which doesn't change minute-to-minute (top
// artists, top tracks, recently-played). Goals:
//
//   - Instant render on subsequent page loads (no waiting on /api/*).
//   - Skip the network entirely while the cached entry is still fresh,
//     reducing pressure on Spotify's per-token rate limit.
//   - On a rate-limited response, the caller can fall back to the
//     last-known-good data instead of switching to someone else's data
//     or showing a blank state.
//
// The cache lives per-browser. Server is the source of truth — we never
// merge cached data into a fresh response, only swap one for the other.

type CacheEntry<T> = { data: T; storedAt: number };

export function readFreshCache<T>(key: string, maxAgeMs: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (Date.now() - entry.storedAt > maxAgeMs) return null;
    return entry.data;
  } catch {
    return null;
  }
}

// Read the cached value when it's older than the fresh TTL but still
// recent enough to be worth showing during a transient API failure.
// Pass `maxAgeMs` to bound how stale you'll accept — without it,
// localStorage entries from days-or-weeks-old visits keep rendering
// indefinitely, which is what made the recently-played list feel
// frozen until cookies were cleared.
export function readStaleCache<T>(
  key: string,
  maxAgeMs: number = Infinity,
): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (
      maxAgeMs !== Infinity &&
      Date.now() - entry.storedAt > maxAgeMs
    ) {
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, data: T) {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry<T> = { data, storedAt: Date.now() };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // quota / private mode — non-fatal, just skip the write.
  }
}

export function clearCache(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// Clear every "lyra:*" entry. Called on logout so a different account
// signing in on the same browser doesn't see cached top artists or
// recently-played from the previous user.
export function clearAllLyraCache() {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("lyra:")) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    // quota / private mode — non-fatal
  }
}
