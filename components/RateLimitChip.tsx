"use client";

import { useEffect, useState } from "react";

// Visible-but-non-spammy notice that the current user's Spotify calls
// are being throttled (HTTP 429) and the app has temporarily fallen
// back to showcase data. Polls /api/profile every 30s and shows a chip
// when the response carries `rateLimited: true`. Auto-dismisses when
// calls resume.
//
// Rendered on /library and /explore. Top-center area is busy, so we
// anchor bottom-center where it can't fight the source toggle / Tags
// & color / share button / now-playing pill chrome.

export default function RateLimitChip() {
  const [throttled, setThrottled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Hysteresis: require two consecutive rateLimited:true polls before
    // showing the chip. Brief 429 blips during normal use (Spotify's
    // rolling window briefly clipping a fast-polled endpoint) are
    // self-correcting within a single poll interval and shouldn't
    // surface as user-visible chrome. Sustained rate-limits last well
    // beyond a single poll, so they still surface promptly. Clearing is
    // immediate — the moment one poll says false, hide.
    let confirmCount = 0;

    async function tick() {
      if (typeof document !== "undefined" && document.hidden) {
        // Don't burn requests on hidden tabs; resume on visibilitychange.
        // Important: still reschedule, otherwise the loop dies the moment
        // the tab is hidden once.
        if (!cancelled) timer = setTimeout(tick, 30_000);
        return;
      }
      try {
        const r = await fetch("/api/profile", { cache: "no-store" });
        if (cancelled) return;
        if (r.ok) {
          const data = (await r.json()) as { rateLimited?: boolean };
          if (data.rateLimited) {
            confirmCount += 1;
            if (confirmCount >= 2) setThrottled(true);
          } else {
            confirmCount = 0;
            setThrottled(false);
          }
        } else {
          // Non-OK (401 = cookie cleared, 5xx = backend issue) — these
          // aren't rate-limit conditions, so clear the chip rather than
          // leaving it stuck on a stale `true`.
          confirmCount = 0;
          setThrottled(false);
        }
      } catch {
        // Network failure — assume the chip's prior state is no longer
        // reliable; clear it. The next successful poll will set it again
        // if we're really still rate-limited.
        if (!cancelled) {
          confirmCount = 0;
          setThrottled(false);
        }
      }
      if (!cancelled) timer = setTimeout(tick, 30_000);
    }

    function onVisibility() {
      if (cancelled) return;
      if (!document.hidden) {
        if (timer) clearTimeout(timer);
        tick();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!throttled) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="overlay-tab pointer-events-auto fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/[0.08] px-3.5 py-1.5 text-[11px] font-semibold text-amber-200 backdrop-blur-md"
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-300" />
      <span>Spotify is throttling your account — showing showcase data</span>
    </div>
  );
}
