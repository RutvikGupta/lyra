"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  aggregateTopArtists,
  aggregateTopArtistsFromPlays,
} from "@/lib/aggregate";
import { buildArtistGraph, type GraphLink, type GraphNode } from "@/lib/graph";
import { loadHistory } from "@/lib/storage";
import type { Criteria } from "./CriteriaBar";

const ForceGraph3D = dynamic(
  () => import("react-force-graph-3d").then((m) => m.default),
  {
    ssr: false,
    loading: () => <Loading />,
  },
);

type CurrentTrack = {
  name: string;
  artists: { name: string; id: string }[];
  albumImage?: string;
};

const NOW_PLAYING_POLL_MS = 2000;

export default function Starfield({ criteria }: { criteria: Criteria }) {
  const [graph, setGraph] = useState<{
    nodes: GraphNode[];
    links: GraphLink[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [currentTrack, setCurrentTrack] = useState<CurrentTrack | null>(null);

  // Stringify the criteria for the dep array — primitive comparison.
  const criteriaKey = JSON.stringify(criteria);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setGraph(null);
      setError(null);
      try {
        let items: unknown[] = [];

        if (criteria.kind === "api") {
          const r = await fetch(
            `/api/top?type=artists&time_range=${criteria.timeRange}`,
            { cache: "no-store" },
          );
          if (r.status === 401) {
            if (!cancelled)
              setError(
                "Connect Spotify on the home page to load your top artists.",
              );
            return;
          }
          if (!r.ok) {
            if (!cancelled) setError(`Failed (${r.status})`);
            return;
          }
          const data = await r.json();
          if (cancelled) return;
          items = data.items ?? [];
        } else {
          const history = await loadHistory();
          if (cancelled) return;
          if (!history || history.plays.length === 0) {
            setError(
              "No uploaded history found. Drop your Spotify ZIP on the upload page first.",
            );
            return;
          }
          const top =
            criteria.year === "all" && criteria.sortBy === "msPlayed"
              ? aggregateTopArtists(history.artists, criteria.limit)
              : aggregateTopArtistsFromPlays(history.plays, {
                  year: criteria.year,
                  sortBy: criteria.sortBy,
                  limit: criteria.limit,
                });
          if (top.length === 0) {
            setError(
              `No plays found${criteria.year !== "all" ? ` in ${criteria.year}` : ""}.`,
            );
            return;
          }
          const r = await fetch("/api/library-artists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artists: top }),
            cache: "no-store",
          });
          if (!r.ok) {
            if (!cancelled) setError(`Library enrichment failed (${r.status})`);
            return;
          }
          const data = await r.json();
          if (cancelled) return;
          items = data.items ?? [];
        }

        const g = buildArtistGraph(
          items as Parameters<typeof buildArtistGraph>[0],
        );
        setGraph(g);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteriaKey]);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Poll now-playing so we can highlight the current artist in the graph.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const res = await fetch("/api/now-playing", { cache: "no-store" });
        if (cancelled) return;

        if (res.status === 401) {
          setCurrentTrack(null);
        } else {
          const data = await res.json();
          if (cancelled) return;
          if (data?.isPlaying && data?.track) {
            const next: CurrentTrack = {
              name: data.track.name,
              artists: (
                data.track.artists ??
                ([] as { name: string; uri: string }[])
              ).map((a: { name: string; uri?: string }) => ({
                name: a.name,
                id: a.uri?.replace("spotify:artist:", "") ?? "",
              })),
              albumImage: data.track.album?.image,
            };
            setCurrentTrack((prev) => {
              // Skip the state update if the track is unchanged — avoids
              // re-rendering ForceGraph3D every 2s for no reason.
              if (
                prev &&
                prev.name === next.name &&
                prev.artists.length === next.artists.length &&
                prev.artists.every((a, i) => a.id === next.artists[i].id)
              ) {
                return prev;
              }
              return next;
            });
          } else {
            setCurrentTrack(null);
          }
        }
      } catch {
        // swallow — next tick will retry
      }
      if (!cancelled) timer = setTimeout(tick, NOW_PLAYING_POLL_MS);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Match the current track against the graph. API mode uses Spotify IDs;
  // library mode uses synthetic `lib:{lowercase_name}` IDs. We populate both
  // forms so a single node lookup works for either source.
  const currentArtistIds = useMemo(() => {
    const keys = new Set<string>();
    for (const a of currentTrack?.artists ?? []) {
      if (a.id) keys.add(a.id);
      if (a.name) keys.add(`lib:${a.name.toLowerCase()}`);
    }
    return keys;
  }, [currentTrack]);

  const matchedNode = useMemo(
    () => graph?.nodes.find((n) => currentArtistIds.has(n.id)) ?? null,
    [graph, currentArtistIds],
  );

  // react-force-graph-3d caches node materials/geometry per node and only
  // re-evaluates color/size callbacks on refresh. Force one whenever the
  // current artist set changes so the highlight actually paints.
  useEffect(() => {
    graphRef.current?.refresh?.();
  }, [currentArtistIds, matchedNode]);

  // Pulsing halo around the now-playing node. We add a separate THREE mesh
  // to the scene and animate its scale + opacity in the existing render
  // loop via requestAnimationFrame — no React re-renders, smooth at 60fps.
  useEffect(() => {
    if (!graph || !matchedNode) return;
    const scene = graphRef.current?.scene?.();
    if (!scene) return;

    const haloRadius = matchedNode.size * 1.6;
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(haloRadius, 24, 24),
      new THREE.MeshBasicMaterial({
        color: 0x1ed760,
        transparent: true,
        opacity: 0.35,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    halo.name = "now-playing-halo";
    halo.raycast = () => {};
    scene.add(halo);

    let rafId = 0;
    let cancelled = false;
    const animate = () => {
      if (cancelled) return;
      const t = Date.now() / 350;
      const scale = 1.1 + 0.35 * Math.sin(t);
      halo.scale.setScalar(scale);
      const mat = halo.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t));
      // Track the live node position — the force layout keeps mutating
      // x/y/z on the same node reference.
      const positioned = matchedNode as GraphNode & {
        x?: number;
        y?: number;
        z?: number;
      };
      halo.position.set(
        positioned.x ?? 0,
        positioned.y ?? 0,
        positioned.z ?? 0,
      );
      rafId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      scene.remove(halo);
      halo.geometry.dispose();
      (halo.material as THREE.Material).dispose();
    };
  }, [graph, matchedNode]);

  // Re-bind controls whenever a fresh graph mounts: left-drag pans the view,
  // right-drag rotates, scroll zooms. Native trackball-style "rotate on left"
  // felt unintuitive for browsing a 2D-ish starfield.
  useEffect(() => {
    if (!graph) return;
    const id = setTimeout(() => {
      const controls = graphRef.current?.controls?.();
      if (!controls?.mouseButtons) return;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      // Match the same gestures for touch devices.
      if (controls.touches) {
        controls.touches = {
          ONE: THREE.TOUCH.PAN,
          TWO: THREE.TOUCH.DOLLY_ROTATE,
        };
      }
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
    }, 0);
    return () => clearTimeout(id);
  }, [graph]);

  // Inject a real starfield (THREE.Points) into the underlying scene so the
  // background isn't just flat black — gives the constellation a sky to live in.
  useEffect(() => {
    if (!graph) return;
    const id = setTimeout(() => {
      const scene = graphRef.current?.scene?.();
      if (!scene || scene.getObjectByName("starfield")) return;
      const stars = createStarfield();
      stars.name = "starfield";
      scene.add(stars);
      // Push the camera far plane out so the distant star shell isn't clipped.
      const camera = graphRef.current?.camera?.();
      if (camera && camera.far < 5000) {
        camera.far = 5000;
        camera.updateProjectionMatrix();
      }
    }, 0);
    return () => clearTimeout(id);
  }, [graph]);

  const detail = selected ?? hovered;
  const genreCounts = graph ? topGenres(graph.nodes) : [];

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      // Suppress the browser context menu so right-click drag can rotate
      // instead of popping a menu.
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Criteria UI lives in the parent (ExploreView) so that the
          starfield component is purely a renderer. */}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        </div>
      )}

      {!graph && !error && <Loading />}

      {graph && size.w > 0 && (
        <div className="absolute inset-0 z-0">
        <ForceGraph3D
          ref={graphRef}
          width={size.w}
          height={size.h}
          graphData={graph}
          backgroundColor="#000000"
          showNavInfo={false}
          controlType="orbit"
          nodeLabel={(n: object) => (n as GraphNode).name}
          nodeColor={(n: object) => {
            const node = n as GraphNode;
            return currentArtistIds.has(node.id)
              ? "#1ed760" // brand green for the now-playing artist
              : node.color;
          }}
          nodeVal={(n: object) => {
            const node = n as GraphNode;
            return currentArtistIds.has(node.id) ? node.size * 4 : node.size;
          }}
          nodeOpacity={0.95}
          // Bump sphere segment count from default 8 → 24 for visibly smoother
          // nodes (still ~negligible perf hit at <500 nodes).
          nodeResolution={24}
          linkColor={(l: object) => {
            // After force layout source/target become full node refs.
            const link = l as { source: GraphNode | string };
            return typeof link.source === "object"
              ? link.source.color
              : "rgba(255,255,255,0.6)";
          }}
          linkOpacity={0.55}
          linkWidth={(l: object) => {
            const shared = (l as GraphLink).shared;
            // shared=1 → 0.6, shared=3 → 1.6, shared=5+ → cap at 3
            return Math.min(3, 0.4 + shared * 0.5);
          }}
          linkLabel={(l: object) => {
            const link = l as Omit<GraphLink, "source" | "target"> & {
              source: GraphNode | string;
              target: GraphNode | string;
            };
            const a =
              typeof link.source === "object"
                ? (link.source as GraphNode).name
                : link.source;
            const b =
              typeof link.target === "object"
                ? (link.target as GraphNode).name
                : link.target;
            const tags = link.sharedGenres
              .slice(0, 4)
              .map(
                (g) =>
                  `<span style="background:rgba(30,215,96,0.18);color:#1ed760;padding:1px 6px;border-radius:6px;margin:0 2px;font-size:10px">${g}</span>`,
              )
              .join("");
            const more =
              link.sharedGenres.length > 4
                ? ` +${link.sharedGenres.length - 4} more`
                : "";
            return `<div style="font-family:system-ui,sans-serif;color:#fff;padding:4px 2px"><div style="opacity:0.7;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:4px">${a} ↔ ${b}</div><div>${tags}${more}</div></div>`;
          }}
          enableNodeDrag={false}
          onNodeHover={(n: object | null) =>
            setHovered((n as GraphNode | null) ?? null)
          }
          onNodeClick={(n: object) => setSelected(n as GraphNode)}
          onBackgroundClick={() => setSelected(null)}
        />
        </div>
      )}

      {detail && (
        <NodeDetails
          node={detail}
          pinned={!!selected}
          onClose={() => setSelected(null)}
        />
      )}

      {graph && genreCounts.length > 0 && (
        <GenreLegend counts={genreCounts} />
      )}

      {currentTrack && (
        <NowPlayingPill
          track={currentTrack}
          matched={!!matchedNode}
          matchedNodeName={matchedNode?.name}
          onFocus={
            matchedNode && graphRef.current
              ? () => focusOnNode(graphRef.current, matchedNode)
              : undefined
          }
        />
      )}
    </div>
  );
}

function createStarfield(): THREE.Group {
  const group = new THREE.Group();
  // Bright stars — fewer but larger
  group.add(makeStarLayer(700, 2.0, 0.95, 0xffffff));
  // Mid stars — medium
  group.add(makeStarLayer(1500, 1.2, 0.7, 0xeaf2ff));
  // Dim stars — many small
  group.add(makeStarLayer(3000, 0.7, 0.4, 0xc0d0ff));
  return group;
}

function makeStarLayer(
  count: number,
  size: number,
  opacity: number,
  color: number,
): THREE.Points {
  const RADIUS = 2000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Uniform points on a sphere shell with a little radial jitter for depth.
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = RADIUS * (0.85 + Math.random() * 0.3);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity,
    sizeAttenuation: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  // Don't intercept mouse picks meant for artist nodes.
  points.raycast = () => {};
  return points;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function focusOnNode(graphInstance: any, node: GraphNode) {
  const x = (node as unknown as { x?: number }).x ?? 0;
  const y = (node as unknown as { y?: number }).y ?? 0;
  const z = (node as unknown as { z?: number }).z ?? 0;
  const distance = 120;
  const dist = Math.hypot(x, y, z) || 1;
  const ratio = 1 + distance / dist;
  graphInstance.cameraPosition(
    { x: x * ratio, y: y * ratio, z: z * ratio },
    node,
    1200,
  );
}

function NowPlayingPill({
  track,
  matched,
  matchedNodeName,
  onFocus,
}: {
  track: CurrentTrack;
  matched: boolean;
  matchedNodeName?: string;
  onFocus?: () => void;
}) {
  return (
    <div
      className={`absolute bottom-4 right-4 flex max-w-sm items-center gap-3 rounded-2xl border bg-black/85 p-3 backdrop-blur-xl transition-colors ${
        matched
          ? "border-[var(--brand)]/40 shadow-[0_0_30px_-8px_rgba(30,215,96,0.5)]"
          : "border-white/[0.08]"
      }`}
    >
      {track.albumImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={track.albumImage}
          alt=""
          className="h-12 w-12 flex-shrink-0 rounded object-cover"
        />
      ) : (
        <div className="h-12 w-12 flex-shrink-0 rounded bg-white/[0.06]" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--brand)]">
            Now playing
          </span>
        </div>
        <div className="mt-0.5 truncate text-sm font-semibold text-white">
          {track.name}
        </div>
        <div className="truncate text-xs text-[var(--muted)]">
          {track.artists.map((a) => a.name).join(", ")}
        </div>
        {matched ? (
          <button
            onClick={onFocus}
            className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--brand)] hover:underline"
          >
            ✦ In your top 50 — focus on{" "}
            {matchedNodeName ?? "match"}
          </button>
        ) : (
          <div className="mt-1.5 text-[10px] uppercase tracking-wider text-[var(--subtle)]">
            Not in your top 50
          </div>
        )}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--brand)]" />
        Loading constellation…
      </div>
    </div>
  );
}

function NodeDetails({
  node,
  pinned,
  onClose,
}: {
  node: GraphNode;
  pinned: boolean;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-4 top-20 max-w-xs rounded-2xl border border-white/[0.08] bg-black/85 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-3">
        {node.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={node.image}
            alt=""
            className="h-14 w-14 flex-shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            className="h-14 w-14 flex-shrink-0 rounded-full"
            style={{ background: node.color }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--brand)]">
            Rank #{node.rank}
          </div>
          <div className="truncate text-base font-bold text-white">
            {node.name}
          </div>
          <div className="text-xs capitalize text-[var(--muted)]">
            {node.primaryGenre}
          </div>
          {(node.listeners > 0 || node.playcount > 0) && (
            <div className="mt-1 flex gap-3 text-[10px] tabular-nums text-[var(--subtle)]">
              {node.listeners > 0 && (
                <span>{formatCount(node.listeners)} listeners</span>
              )}
              {node.playcount > 0 && (
                <span>{formatCount(node.playcount)} plays</span>
              )}
            </div>
          )}
        </div>
      </div>
      {node.genres.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {node.genres.slice(0, 8).map((g) => (
            <span
              key={g}
              className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white"
              style={{
                borderLeft: `2px solid ${node.primaryGenre === g ? node.color : "transparent"}`,
              }}
            >
              {g}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <a
          href={
            node.id.startsWith("lib:")
              ? `https://open.spotify.com/search/${encodeURIComponent(node.name)}`
              : `https://open.spotify.com/artist/${node.id}`
          }
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] px-3 py-1.5 text-[11px] font-bold text-black transition-colors hover:bg-[var(--brand-hover)]"
        >
          <SpotifyGlyph />
          Open in Spotify
        </a>
        {pinned && (
          <button
            onClick={onClose}
            className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] hover:text-white"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function SpotifyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-3 w-3"
      fill="currentColor"
    >
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.521 17.34a.748.748 0 0 1-1.03.249c-2.823-1.724-6.376-2.114-10.561-1.158a.748.748 0 1 1-.333-1.46c4.581-1.045 8.515-.594 11.676 1.34.351.214.464.674.248 1.029zm1.473-3.267a.935.935 0 0 1-1.286.308c-3.231-1.987-8.156-2.563-11.978-1.402a.935.935 0 1 1-.542-1.79c4.366-1.323 9.794-.679 13.498 1.598.44.27.582.847.308 1.286zm.13-3.403c-3.876-2.302-10.27-2.514-13.97-1.39a1.122 1.122 0 1 1-.65-2.148c4.244-1.286 11.302-1.038 15.764 1.612.534.317.71 1.008.394 1.541a1.122 1.122 0 0 1-1.538.385z" />
    </svg>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function topGenres(
  nodes: GraphNode[],
): { genre: string; count: number; color: string }[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    counts.set(n.primaryGenre, (counts.get(n.primaryGenre) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([genre, count]) => ({
      genre,
      count,
      color: nodes.find((n) => n.primaryGenre === genre)?.color ?? "#888",
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function GenreLegend({
  counts,
}: {
  counts: { genre: string; count: number; color: string }[];
}) {
  return (
    <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 rounded-2xl border border-white/[0.08] bg-black/70 px-4 py-3 text-xs backdrop-blur-md">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
        Top genres
      </div>
      {counts.map((c) => (
        <div key={c.genre} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: c.color }}
          />
          <span className="text-white">{c.genre}</span>
          <span className="ml-auto text-[var(--muted)]">{c.count}</span>
        </div>
      ))}
    </div>
  );
}
