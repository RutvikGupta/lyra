"use client";

import { useEffect, useState } from "react";
import { bakeSnapshot } from "@/lib/showcase-library-bake";
import { loadHistory } from "@/lib/storage";

// Owner-only button on /library that bakes the current IndexedDB history
// into a LibrarySnapshot and POSTs it to the publish endpoint. Hidden
// when not authed (so visitors don't see "publish" controls). Hidden
// when there's no history loaded — nothing to bake.

type State =
  | { kind: "idle" }
  | { kind: "baking" }
  | { kind: "publishing" }
  | { kind: "ok"; mode: string }
  | { kind: "error"; message: string };

export default function PublishShowcaseButton() {
  const [isOwner, setIsOwner] = useState<boolean | null>(null);
  const [hasHistory, setHasHistory] = useState<boolean | null>(null);
  const [ownerName, setOwnerName] = useState<string>("Owner");
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/profile", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null,
      ),
      loadHistory(),
    ]).then(([profile, history]) => {
      if (cancelled) return;
      // Gate on isOwner — random authed visitors with their own ZIP
      // shouldn't see this control. Server-side publish endpoint
      // enforces the same check independently.
      setIsOwner(!!profile?.isOwner);
      setHasHistory(!!history && history.plays.length > 0);
      if (profile?.name) setOwnerName(profile.name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isOwner !== true || hasHistory !== true) return null;

  async function publish() {
    setState({ kind: "baking" });
    try {
      const history = await loadHistory();
      if (!history) {
        setState({ kind: "error", message: "No library data loaded" });
        return;
      }

      // Pull the top artist names so the publish endpoint doesn't have to.
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
        setState({
          kind: "error",
          message: `Enrichment failed (${enrichRes.status})`,
        });
        return;
      }
      const enrichJson = (await enrichRes.json()) as {
        items: { name: string; genres: string[] }[];
      };

      const snapshot = bakeSnapshot(history, ownerName, enrichJson.items);

      setState({ kind: "publishing" });
      const pub = await fetch("/api/showcase/library/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
        cache: "no-store",
      });
      if (!pub.ok) {
        const data = await pub.json().catch(() => ({}));
        const detail = data.detail
          ? ` — ${String(data.detail).slice(0, 240)}`
          : "";
        setState({
          kind: "error",
          message: `Publish failed: ${data.error ?? pub.status}${detail}`,
        });
        return;
      }
      const result = (await pub.json()) as { mode: string };
      setState({ kind: "ok", mode: result.mode });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  function label() {
    switch (state.kind) {
      case "baking":
        return "Baking…";
      case "publishing":
        return "Publishing…";
      case "ok":
        return state.mode === "blob"
          ? "Published to Blob ✓"
          : "Saved locally ✓";
      case "error":
        return "Retry";
      default:
        return "↻ Refresh showcase";
    }
  }

  // Inline-flex by default — positioned by the OwnerLibraryControls
  // wrapper on /library so this button sits next to ← Lyra in the
  // top-left header region, out of the way of right-side overlays.
  return (
    <div className="pointer-events-auto flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={publish}
        disabled={state.kind === "baking" || state.kind === "publishing"}
        className="overlay-tab inline-flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-[12px] font-bold text-white/85 backdrop-blur-md transition-colors hover:text-white disabled:opacity-50"
        title="Bake your current library into a public showcase snapshot"
      >
        {label()}
      </button>
      {state.kind === "error" && (
        <span className="max-w-xs rounded-md bg-red-500/15 px-2 py-1 text-[10px] text-red-200">
          {state.message}
        </span>
      )}
    </div>
  );
}
