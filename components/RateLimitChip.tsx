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

    async function tick() {
      if (typeof document !== "undefined" && document.hidden) {
        // Don't burn requests on hidden tabs; resume on visibilitychange.
        return;
      }
      try {
        const r = await fetch("/api/profile", { cache: "no-store" });
        if (cancelled) return;
        if (r.ok) {
          const data = (await r.json()) as { rateLimited?: boolean };
          setThrottled(!!data.rateLimited);
        }
      } catch {
        // Swallow — next tick retries.
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
