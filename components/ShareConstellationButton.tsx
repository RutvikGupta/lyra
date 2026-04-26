"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bakeSnapshot } from "@/lib/showcase-library-bake";
import { SNAPSHOT_VERSION, type ArtistsSnapshot, type Snapshot } from "@/lib/showcase-library";
import { loadHistory } from "@/lib/storage";

// Anyone-can-share button. Bakes a Snapshot and posts to /api/share/create,
// returning a short ID that becomes /share/{id}. Two modes:
//
//   library  — bakes a LibrarySnapshot from IndexedDB. Falls back to the
//              owner's published showcase snapshot when there's no local
//              history (so visitors viewing the showcase fallback can
//              still share what they're looking at).
//   artists  — bakes an ArtistsSnapshot from /api/top using the supplied
//              timeRange. Doesn't need IndexedDB; works for anyone authed
//              against Spotify.

type Mode = "library" | "artists";

type State =
  | { kind: "idle" }
  | { kind: "baking" }
  | { kind: "posting" }
  | { kind: "ok"; url: string }
  | { kind: "error"; message: string };

export default function ShareConstellationButton({
  mode,
  timeRange,
}: {
  mode: Mode;
  // Required for mode="artists". Ignored for mode="library".
  timeRange?: "short_term" | "medium_term" | "long_term";
}) {
  // For library mode: gates on having local history OR a published
  // showcase to fall back to. For artists mode: gates on graph-ready —
  // we ping /api/top once on mount and accept any 200 (item list may be
  // empty for unauthed users without showcase, in which case the button
  // hides itself).
  const [ready, setReady] = useState<boolean | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [toast, setToast] = useState<
    | { kind: "ok"; url: string }
    | { kind: "error"; message: string }
    | null
  >(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (mode === "library") {
        const h = await loadHistory();
        if (cancelled) return;
        if (h && h.plays.length > 0) {
          setReady(true);
          return;
        }
        // Fall back to published showcase — if it exists, anyone viewing
        // /library is seeing it and should be able to share it.
        try {
          const r = await fetch("/api/showcase/library", {
            cache: "no-store",
          });
          if (cancelled) return;
          setReady(r.ok);
        } catch {
          if (!cancelled) setReady(false);
        }
        return;
      }
      // artists: always available on /explore. Starfield itself gates
      // whether anything renders (auth or showcase fallback); if a user
      // clicks share with nothing on screen, the bake surfaces a clear
      // toast. Avoids a duplicate /api/top fetch on mount.
      setReady(true);
    }
    check();
    return () => {
      cancelled = true;
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [mode, timeRange]);

  function showToast(t: NonNullable<typeof toast>) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(t);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  }

  if (ready !== true) return null;

  async function bakeLibrary(): Promise<Snapshot | { error: string }> {
    const history = await loadHistory();
    let displayName = "A Lyra listener";
    try {
      const r = await fetch("/api/profile", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        if (data?.name) displayName = data.name;
      }
    } catch {
      // ignore
    }

    if (history && history.plays.length > 0) {
      const topArtistNames = Array.from(
        new Set(history.plays.map((p) => p.artistName)),
      ).slice(0, 250);
      const enrichRes = await fetch("/api/library-artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artists: topArtistNames.map((name) => ({
            name,
            playCount: 1,
            msPlayed: 0,
            trackCount: 0,
          })),
        }),
        cache: "no-store",
      });
      if (!enrichRes.ok) {
        return { error: `Enrichment failed (${enrichRes.status})` };
      }
      const enrichJson = (await enrichRes.json()) as {
        items: { name: string; genres: string[] }[];
      };
      return bakeSnapshot(history, displayName, enrichJson.items);
    }

    // No local history — re-share the published showcase snapshot.
    const sr = await fetch("/api/showcase/library", { cache: "no-store" });
    if (!sr.ok) {
      return {
        error: `No history loaded and no published showcase (${sr.status})`,
      };
    }
    const showcase = (await sr.json()) as Snapshot;
    return showcase;
  }

  async function bakeArtists(): Promise<Snapshot | { error: string }> {
    let displayName = "A Lyra listener";
    try {
      const r = await fetch("/api/profile", { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        if (data?.name) displayName = data.name;
      }
    } catch {
      // ignore
    }

    const tr = timeRange ?? "long_term";
    const r = await fetch(`/api/top?type=artists&time_range=${tr}`, {
      cache: "no-store",
    });
    if (!r.ok) return { error: `Top artists fetch failed (${r.status})` };
    const data = (await r.json()) as { items?: ArtistsSnapshot["items"] };
    const items = data.items ?? [];
    if (items.length === 0) return { error: "No artists to share" };
    const snap: ArtistsSnapshot = {
      version: SNAPSHOT_VERSION,
      kind: "artists",
      ownerName: displayName,
      exportedAt: Date.now(),
      timeRange: tr,
      items,
    };
    return snap;
  }

  async function share() {
    setState({ kind: "baking" });
    try {
      const snap = mode === "library"
        ? await bakeLibrary()
        : await bakeArtists();
      if ("error" in snap) {
        setState({ kind: "idle" });
        showToast({ kind: "error", message: snap.error });
        return;
      }

      setState({ kind: "posting" });
      const res = await fetch("/api/share/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snap),
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setState({ kind: "idle" });
        showToast({
          kind: "error",
          message: `Share failed: ${data.error ?? res.status}`,
        });
        return;
      }
      const result = (await res.json()) as { id: string };
      const url = `${window.location.origin}/share/${result.id}`;

      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // older browsers — toast still shows the URL so they can copy.
      }
      setState({ kind: "idle" });
      showToast({ kind: "ok", url });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setState({ kind: "idle" });
      showToast({ kind: "error", message });
    }
  }

  // Button label tracks both the in-flight state and the post-success
  // toast, so the user can confirm "Link copied" without watching the
  // button snap back instantly.
  function label() {
    switch (state.kind) {
      case "baking":
        return "Baking…";
      case "posting":
        return "Sharing…";
      default:
        if (toast?.kind === "ok") return "Link copied ✓";
        if (toast?.kind === "error") return "Retry share";
        return "↗ Share constellation";
    }
  }

  // Inline-flex; positioned by the parent wrapper. Toast renders as a
  // fixed bottom-center bar (below) so it doesn't fight the source-toggle /
  // filter chrome at the top.
  return (
    <>
      <div className="pointer-events-auto flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={share}
          disabled={state.kind === "baking" || state.kind === "posting"}
          className="overlay-tab inline-flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-[12px] font-bold text-white/85 backdrop-blur-md transition-colors hover:text-white disabled:opacity-50"
          title="Bake your constellation into a shareable link"
        >
          {label()}
        </button>
      </div>

      {toast && typeof document !== "undefined"
        ? // Portal to document.body so the toast escapes any ancestor
          // containing block (Three.js / overlay-tab parents apply
          // backdrop-filter / transform that would scope `position:
          // fixed` to themselves). Centering uses a full-viewport
          // `inset: 0` flex wrapper so the toast inside doesn't carry
          // any horizontal transform of its own — the slide-up keyframe
          // only animates translateY, so it can't fight the layout.
          createPortal(
            <div
              style={{
                position: "fixed",
                inset: 0,
                width: "100vw",
                height: "100vh",
                zIndex: 60,
                pointerEvents: "none",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                paddingBottom: "1.5rem",
              }}
            >
              <div
                className="lyra-toast-up pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 px-4 py-2.5 text-[12px] font-semibold text-white/90 shadow-2xl shadow-black/60 backdrop-blur-md"
                style={{
                  background:
                    toast.kind === "ok"
                      ? "linear-gradient(135deg, rgba(30,215,96,0.20), rgba(0,0,0,0.92))"
                      : "linear-gradient(135deg, rgba(239,68,68,0.20), rgba(0,0,0,0.92))",
                }}
                role="status"
                aria-live="polite"
              >
                {toast.kind === "ok" ? (
                  <>
                    <span aria-hidden className="text-[var(--brand)]">
                      ✓
                    </span>
                    <span>Share link copied</span>
                    <a
                      href={toast.url}
                      target="_blank"
                      rel="noreferrer"
                      className="max-w-[40ch] truncate text-[var(--brand)] underline-offset-2 hover:underline"
                    >
                      {toast.url}
                    </a>
                  </>
                ) : (
                  <>
                    <span aria-hidden className="text-red-300">
                      !
                    </span>
                    <span className="max-w-[60ch] truncate text-red-100">
                      {toast.message}
                    </span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setToast(null)}
                  className="-mr-1 ml-1 rounded-full p-1 text-white/60 transition-colors hover:text-white"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
