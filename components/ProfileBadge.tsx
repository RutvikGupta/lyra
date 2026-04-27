"use client";

import { useEffect, useRef, useState } from "react";
import { clearAllLyraCache } from "@/lib/client-cache";

type Profile = {
  authenticated: boolean;
  name?: string;
  image?: string | null;
  profileUrl?: string | null;
};

// Cache the last-known profile in localStorage so a rate-limited
// /api/profile response (authenticated:true with no name) can still
// render the user's name + avatar instead of falling back to a generic
// "Connected" pill. Cleared when the server says we're unauthenticated.
const CACHE_KEY = "lyra:profile";

function readCache(): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    if (!parsed?.authenticated) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(p: Profile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(p));
  } catch {
    // quota / private mode — non-fatal
  }
}

function clearCache() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

export default function ProfileBadge() {
  // Hydrate from cache so the second-and-later page loads render the
  // name immediately, even if /api/profile is briefly rate-limited.
  const [profile, setProfile] = useState<Profile | null>(() => readCache());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile", { cache: "no-store" })
      .then((r) =>
        r.status === 401 ? { authenticated: false } : r.json(),
      )
      .then((p: Profile) => {
        if (cancelled) return;
        if (!p.authenticated) {
          clearCache();
          setProfile(p);
          return;
        }
        if (p.name) {
          // Fresh, complete profile — write through to cache and render.
          writeCache(p);
          setProfile(p);
          return;
        }
        // Authed-but-no-name (rate-limited). Prefer the cached profile
        // if we have one so the badge keeps the user's name + avatar
        // instead of regressing to "Connected".
        const cached = readCache();
        setProfile(cached ?? p);
      })
      .catch(() => {
        if (cancelled) return;
        // Network failure — keep whatever's already on screen (cached
        // or null). Don't flip to "unauthenticated" on a transient.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Probe still pending — render nothing rather than flickering between
  // "Connect" and "you're signed in" on first paint.
  if (profile === null) return null;

  // Unauthed visitor (or owner who hasn't connected yet): show the connect
  // button so the owner can wire up the showcase refresh token, and so
  // visitors can hop straight into /upload after auth if they want their
  // own data.
  if (!profile.authenticated) {
    return (
      <a
        href="/api/auth/login"
        className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-black transition-transform hover:scale-[1.03] active:scale-[0.99]"
      >
        Connect Spotify
      </a>
    );
  }

  // Authed but no name yet — Spotify is rate-limiting /me so /api/profile
  // returned the empty-shell {authenticated: true} response. Show a
  // neutral "Connected" pill rather than falling through to "Connect
  // Spotify" (which would mislead a logged-in user into reconnecting and
  // making the rate-limit worse). The RateLimitChip explains *why*
  // there's no name yet.
  if (!profile.name) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-semibold text-white/85">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
        <span>Connected</span>
      </div>
    );
  }

  return <AuthedBadge profile={profile} />;
}

function AuthedBadge({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Wipe every "lyra:*" localStorage entry before the form POST so the
  // next account signing in on this browser sees a fresh start (no
  // stale top-artists, no stale profile name flashing).
  function onLogoutSubmit() {
    clearAllLyraCache();
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex cursor-pointer items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 text-sm transition-colors hover:bg-white/[0.08]"
      >
        {profile.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.image}
            alt=""
            className="h-7 w-7 flex-shrink-0 rounded-full"
          />
        ) : (
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-xs font-bold text-black">
            {profile.name?.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="font-semibold text-white">{profile.name}</span>
        <span aria-hidden className="text-[10px] text-[var(--muted)]">▾</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 flex w-44 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/85 text-sm shadow-xl backdrop-blur-md"
        >
          {profile.profileUrl && (
            <a
              role="menuitem"
              href={profile.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2.5 text-left font-medium text-white/90 transition-colors hover:bg-white/[0.08]"
              onClick={() => setOpen(false)}
            >
              Open in Spotify
            </a>
          )}
          <form action="/api/auth/logout" method="POST" onSubmit={onLogoutSubmit}>
            <button
              role="menuitem"
              type="submit"
              className="w-full cursor-pointer border-t border-white/[0.06] px-3.5 py-2.5 text-left font-medium text-white/90 transition-colors hover:bg-white/[0.08]"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
