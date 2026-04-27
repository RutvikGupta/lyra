"use client";

import { useEffect, useState } from "react";
import { loadHistory } from "@/lib/storage";

type Mode = "loading" | "owner" | "visitor-snapshot" | "personal" | "hidden";

// Small chip rendered on /library and /explore. Tells visitors whose
// data they're looking at when no local upload exists. Hidden for the
// signed-in owner (they already see their own data, no clarification
// needed) and when no snapshot/showcase is configured.
//
// Mode resolution:
//   - has local IndexedDB data    → personal (don't render)
//   - authed AND is showcase owner → owner (don't render — it's their own)
//   - else fetch /api/showcase/profile → visitor-snapshot if found
//   - else hidden
export default function ShowcaseOwnerBanner({
  scope = "library",
}: {
  scope?: "library" | "explore";
}) {
  const [mode, setMode] = useState<Mode>("loading");
  const [ownerName, setOwnerName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [history, profile] = await Promise.all([
        loadHistory().catch(() => null),
        fetch("/api/profile", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (cancelled) return;
      if (history && history.plays.length > 0) {
        setMode("personal");
        return;
      }
      if (profile?.isOwner) {
        setMode("owner");
        return;
      }
      // Visitor — see if we can name the owner.
      try {
        const r = await fetch("/api/showcase/profile", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (!r.ok) {
          setMode("hidden");
          return;
        }
        const data = (await r.json()) as {
          profile?: { displayName?: string } | null;
        };
        if (data.profile?.displayName) {
          setOwnerName(data.profile.displayName);
          setMode("visitor-snapshot");
        } else {
          setMode("hidden");
        }
      } catch {
        if (!cancelled) setMode("hidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode !== "visitor-snapshot" || !ownerName) return null;

  const subject =
    scope === "explore"
      ? `${ownerName}'s top artists`
      : `${ownerName}'s library`;
  // /explore needs Spotify auth to render the *visitor's* top artists
  // (no upload path replaces it). /library, by contrast, accepts an
  // uploaded data ZIP without sign-in — point visitors at /upload
  // instead of asking them to log in.
  const ctaHref = scope === "explore" ? "/api/auth/login" : "/upload";
  const ctaLabel =
    scope === "explore" ? "Sign in for yours" : "Upload yours";

  return (
    <div
      // Sit on the left side of the source toggle (which is centered at
      // top-3/top-6). On narrow screens the source toggle wraps onto its
      // own row anyway, so anchoring left at top-5/top-6 keeps the
      // banner clear of the centered chrome at any width. Padding +
      // typography match the ← Lyra link so the two read as a paired
      // header strip, not two different control families.
      className="overlay-tab pointer-events-auto absolute left-20 top-5 z-40 flex max-w-[calc(50vw-7rem)] items-center gap-2 truncate rounded-full border border-white/10 px-3.5 py-2 text-[13px] font-bold text-white/85 backdrop-blur-md sm:left-28 sm:top-6"
      role="status"
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--brand)]"
      />
      <span className="truncate">Viewing {subject}</span>
      <a
        href={ctaHref}
        className="ml-1 flex-shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-white/20"
      >
        {ctaLabel}
      </a>
    </div>
  );
}
