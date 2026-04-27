"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MOUSE,
  Points,
  PointsMaterial,
  SphereGeometry,
  TOUCH,
} from "three";
import {
  aggregateTopArtists,
  aggregateTopArtistsFromPlays,
  aggregateTopTracksFromPlays,
} from "@/lib/aggregate";
import { clusterColor, detectClusters } from "@/lib/cluster";
import { nodeMatchesMoodFilter } from "@/lib/moods";
import { computeCoplayMatrix, topCoplayed, type CoplayMatrix } from "@/lib/coplay";
import {
  buildArtistGraph,
  buildTrackGraph,
  type GraphLink,
  type GraphNode,
} from "@/lib/graph";
import {
  isArtistsSnapshot,
  type ArtistsSnapshot,
  type LibrarySnapshot,
  type Snapshot,
} from "@/lib/showcase-library";
import { loadHistory } from "@/lib/storage";
import type { Play } from "@/lib/types";
import type { Criteria, LibraryCriteria } from "./CriteriaBar";
import NodeList from "./NodeList";
import TagsPanel from "./TagsPanel";

const ForceGraph3D = dynamic(
  () => import("react-force-graph-3d").then((m) => m.default),
  {
    ssr: false,
    loading: () => <Loading />,
  },
);

type CurrentTrack = {
  name: string;
  uri?: string;
  artists: { name: string; id: string }[];
  albumImage?: string;
};

// Constellation poll: 5s. The matched-node halo's pulse is animated
// in a local RAF loop independent of this poll, so the visual
// pulsation looks the same regardless of poll cadence — only the
// "which node should be glowing" detection refreshes here. Pairs with
// NowPlaying.tsx on the home page; combined cuts ~70% of /me requests
// per authed session, well under Spotify's rolling-window threshold.
const NOW_PLAYING_POLL_MS = 5000;

// Coarse mobile detection — used to dial back mesh resolution and the
// background starfield density. Lower-end mobile GPUs choke on the default
// 24-segment node spheres and 5200-point starfield, so we halve both.
function isLowPowerDevice(): boolean {
  if (typeof window === "undefined") return false;
  const narrow = window.matchMedia?.("(max-width: 768px)").matches ?? false;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return narrow || coarse;
}

// Local alias kept for the existing library-snapshot branch — a
// shape-compatible subset of LibrarySnapshot.
type SharedLibrarySnapshot = Pick<
  LibrarySnapshot,
  "topTracks" | "topArtists" | "artistGenres"
> & { ownerName?: string };

export default function Starfield({
  criteria,
  onCriteriaChange,
  sharedSnapshot,
}: {
  criteria: Criteria;
  onCriteriaChange?: (next: Criteria) => void;
  // When provided, renders directly from this snapshot (used by
  // /share/[id]) instead of falling back to /api/showcase/library, the
  // live /api/top, or IndexedDB. Branches on snapshot kind:
  //   library snapshot → criteria.kind="library" path
  //   artists snapshot → criteria.kind="api" path
  sharedSnapshot?: Snapshot;
}) {
  const sharedArtists: ArtistsSnapshot | null =
    sharedSnapshot && isArtistsSnapshot(sharedSnapshot) ? sharedSnapshot : null;
  const sharedLibrary: SharedLibrarySnapshot | null =
    sharedSnapshot && !isArtistsSnapshot(sharedSnapshot) ? sharedSnapshot : null;
  // rawGraph holds the unfiltered output of buildArtistGraph/buildTrackGraph.
  // displayGraph is the version actually rendered, after Phase-B tag-filter
  // + cluster-color transforms — recomputed cheaply when criteria change.
  const [rawGraph, setRawGraph] = useState<{
    nodes: GraphNode[];
    links: GraphLink[];
  } | null>(null);
  const [plays, setPlays] = useState<Play[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [showCoPlay, setShowCoPlay] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [currentTrack, setCurrentTrack] = useState<CurrentTrack | null>(null);
  const [lowPower, setLowPower] = useState(false);
  useEffect(() => {
    setLowPower(isLowPowerDevice());
  }, []);

  // We re-fetch / re-build the raw graph only when criteria fields that
  // affect the *underlying data* change (source, year, sort, limit, time-A
  // filters). Tags + colorMode are display-only — they apply post-build.
  const dataKey =
    criteria.kind === "api"
      ? `api:${criteria.timeRange}`
      : `lib:${criteria.nodeType}:${criteria.year}:${criteria.sortBy}:${criteria.limit}:${criteria.timeOfDay.join(",")}:${criteria.dayOfWeek}:${criteria.sessionEntry}:${criteria.lovedOnly}:${criteria.skipBucket}:${criteria.discoveryYear}`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setRawGraph(null);
      setError(null);
      try {
        let items: unknown[] = [];

        if (criteria.kind === "api") {
          // /share/[id] artist snapshot path: skip the network round-trip
          // and render directly from the baked items. Recipients have no
          // OAuth, so /api/top would just 401 anyway.
          if (sharedArtists) {
            items = sharedArtists.items;
          } else {
            // Retry on 503 — the route returns that during the post-OAuth
            // token-propagation window so we don't silently serve showcase
            // data to a freshly signed-in user. Backoff: 1s, 2s, 4s.
            const RETRY_DELAYS = [1000, 2000, 4000];
            let attempt = 0;
            let r: Response;
            while (true) {
              r = await fetch(
                `/api/top?type=artists&time_range=${criteria.timeRange}`,
                { cache: "no-store" },
              );
              if (r.status !== 503 || attempt >= RETRY_DELAYS.length) break;
              await new Promise((resolve) =>
                setTimeout(resolve, RETRY_DELAYS[attempt++]),
              );
              if (cancelled) return;
            }
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
          }
        } else {
          const history = sharedLibrary ? null : await loadHistory();
          if (cancelled) return;
          if (history?.plays?.length) setPlays(history.plays);

          // Visitor-fallback chain:
          //   sharedSnapshot prop (passed by /share/[id]) →
          //   /api/showcase/library (the owner's published snapshot)
          // Capability is the same in both paths — pre-aggregated tracks
          // + per-track firstPlayed for the Discovered filter, no raw
          // plays for time-of-day filtering.
          if (!history || history.plays.length === 0) {
            let snap: SharedLibrarySnapshot | null = sharedLibrary;
            if (!snap) {
              const sr = await fetch("/api/showcase/library", {
                cache: "no-store",
              });
              if (sr.status === 404) {
                if (!cancelled)
                  setError(
                    "No uploaded history found. Drop your Spotify ZIP on the upload page first.",
                  );
                return;
              }
              if (!sr.ok) {
                if (!cancelled)
                  setError(`Showcase library fetch failed (${sr.status})`);
                return;
              }
              snap = (await sr.json()) as SharedLibrarySnapshot;
              if (cancelled) return;
            }

            const artistGenres = new Map<string, string[]>(
              Object.entries(snap.artistGenres),
            );

            if (criteria.nodeType === "artists") {
              // Use `lib:{name}` IDs to match /api/library-artists so the
              // now-playing pulse finds the right node (the matcher
              // queries this exact key form).
              const items = snap.topArtists
                .slice(0, criteria.limit)
                .map((a, i) => ({
                  id: `lib:${a.name.toLowerCase()}`,
                  rank: i + 1,
                  name: a.name,
                  genres: artistGenres.get(a.name.toLowerCase()) ?? [],
                  popularity: 0,
                  myPlayCount: a.playCount,
                  myMsPlayed: a.msPlayed,
                }));
              const g = buildArtistGraph(items, criteria.sortBy);
              setRawGraph(g);
              return;
            }

            // Snapshot tracks include firstPlayed → we can honor the
            // Discovered-year filter even without raw plays.
            let snapTracks = snap.topTracks;
            if (criteria.discoveryYear !== "all") {
              snapTracks = snapTracks.filter(
                (t) =>
                  typeof t.firstPlayed === "number" &&
                  new Date(t.firstPlayed).getUTCFullYear() ===
                    criteria.discoveryYear,
              );
            }
            const trackInputs = snapTracks
              .slice(0, criteria.limit)
              .map((t, i) => ({
                uri: t.uri,
                rank: i + 1,
                name: t.name,
                artistName: t.artistName,
                albumName: t.albumName,
                playCount: t.playCount,
                msPlayed: t.msPlayed,
              }));
            if (trackInputs.length === 0) {
              setError(
                `No tracks discovered${
                  criteria.discoveryYear !== "all"
                    ? ` in ${criteria.discoveryYear}`
                    : ""
                }.`,
              );
              return;
            }
            const g = buildTrackGraph(
              trackInputs,
              artistGenres,
              criteria.sortBy,
            );
            setRawGraph(g);
            return;
          }

          // Any active phase-A filter forces play-level recompute (the
          // pre-aggregated history.artists won't reflect them).
          const hasFilters =
            criteria.timeOfDay.length > 0 ||
            criteria.dayOfWeek !== "all" ||
            criteria.sessionEntry !== "all";

          if (criteria.nodeType === "artists") {
            const top =
              criteria.year === "all" &&
              criteria.sortBy === "msPlayed" &&
              !hasFilters
                ? aggregateTopArtists(history.artists, criteria.limit)
                : aggregateTopArtistsFromPlays(history.plays, {
                    year: criteria.year,
                    sortBy: criteria.sortBy,
                    limit: criteria.limit,
                    timeOfDay: criteria.timeOfDay,
                    dayOfWeek: criteria.dayOfWeek,
                    sessionEntry: criteria.sessionEntry,
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
            const g = buildArtistGraph(
              items as Parameters<typeof buildArtistGraph>[0],
              criteria.sortBy,
            );
            setRawGraph(g);
            return;
          }

          // Track mode: aggregate top tracks, enrich their unique artists,
          // build track graph using artist → genres mapping.
          const topTracks = aggregateTopTracksFromPlays(history.plays, {
            year: criteria.year,
            sortBy: criteria.sortBy,
            limit: criteria.limit,
            timeOfDay: criteria.timeOfDay,
            dayOfWeek: criteria.dayOfWeek,
            sessionEntry: criteria.sessionEntry,
            lovedOnly: criteria.lovedOnly,
            skipBucket: criteria.skipBucket,
            discoveryYear: criteria.discoveryYear,
          });
          if (topTracks.length === 0) {
            setError(
              `No plays found${criteria.year !== "all" ? ` in ${criteria.year}` : ""}.`,
            );
            return;
          }
          const uniqueArtists = Array.from(
            new Set(topTracks.map((t) => t.artistName)),
          ).map((name) => ({
            name,
            playCount: 1,
            msPlayed: 0,
            trackCount: 0,
          }));
          const r = await fetch("/api/library-artists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artists: uniqueArtists }),
            cache: "no-store",
          });
          if (!r.ok) {
            if (!cancelled) setError(`Library enrichment failed (${r.status})`);
            return;
          }
          const data = (await r.json()) as {
            items: { name: string; genres: string[] }[];
          };
          if (cancelled) return;
          const artistGenres = new Map<string, string[]>();
          for (const a of data.items ?? []) {
            artistGenres.set(a.name.toLowerCase(), a.genres ?? []);
          }
          const trackInputs = topTracks.map((t, i) => ({
            uri: t.uri,
            rank: i + 1,
            name: t.name,
            artistName: t.artistName,
            albumName: t.albumName,
            playCount: t.playCount,
            msPlayed: t.msPlayed,
          }));
          const g = buildTrackGraph(trackInputs, artistGenres, criteria.sortBy);
          setRawGraph(g);
          return;
        }

        const g = buildArtistGraph(
          items as Parameters<typeof buildArtistGraph>[0],
        );
        setRawGraph(g);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey]);

  // Derive the displayed graph from rawGraph + display-only criteria.
  // Critical: we MUST NOT clone node objects here. d3-force-3d resolves
  // each link's `source` / `target` from string IDs to node references on
  // the first tick and mutates the link in place. If we hand it a parallel
  // set of recolored node clones, the edges stay attached to the old refs
  // while the recolored clones get a fresh layout — visually, edges
  // collapse into a knot in the center while the nodes scatter outside.
  // So filtering returns subset arrays of the *same* references, and
  // cluster coloring is applied at render time via a Map override.
  const libCriteria = criteria.kind === "library" ? criteria : null;
  const { graph, clusterOverride, clusterInfo } = useMemo(() => {
    if (!rawGraph)
      return { graph: null, clusterOverride: null, clusterInfo: null };
    const tags = libCriteria?.tags ?? [];
    const colorMode = libCriteria?.colorMode ?? "genre";

    let nodes = rawGraph.nodes;
    let links = rawGraph.links;

    const moods = libCriteria?.moods ?? [];
    if (tags.length > 0 || moods.length > 0) {
      const wanted = new Set(tags);
      const keep = new Set<string>();
      nodes = rawGraph.nodes.filter((n) => {
        // Tag filter — any-match. Empty array passes everyone.
        let tagOK = wanted.size === 0;
        if (!tagOK) {
          for (const g of n.genres) {
            if (wanted.has(g)) {
              tagOK = true;
              break;
            }
          }
        }
        if (!tagOK) return false;
        // Mood filter — node passes if any of its tags maps to any
        // selected mood (substring match against the mood keyword list).
        if (!nodeMatchesMoodFilter(n.genres, moods)) return false;
        keep.add(n.id);
        return true;
      });
      links = rawGraph.links.filter((l) => {
        const s = typeof l.source === "string" ? l.source : (l.source as { id: string }).id;
        const t = typeof l.target === "string" ? l.target : (l.target as { id: string }).id;
        return keep.has(s) && keep.has(t);
      });
    }

    let clusterOverride: Map<string, string> | null = null;
    let clusterInfo:
      | { label: string; color: string; count: number }[]
      | null = null;
    if (colorMode === "cluster" && nodes.length > 0) {
      const clusters = detectClusters(nodes, links);
      clusterOverride = new Map();
      // Tally tag frequencies per cluster so we can name each cluster by
      // its most common Last.fm tag — gives the legend semantic labels
      // ("indie", "trap", "pop") instead of meaningless numbers.
      const tagsByCluster = new Map<number, Map<string, number>>();
      const sizeByCluster = new Map<number, number>();
      for (const n of nodes) {
        const cid = clusters.get(n.id) ?? 0;
        clusterOverride.set(n.id, clusterColor(cid));
        sizeByCluster.set(cid, (sizeByCluster.get(cid) ?? 0) + 1);
        let tally = tagsByCluster.get(cid);
        if (!tally) {
          tally = new Map();
          tagsByCluster.set(cid, tally);
        }
        for (const g of n.genres) {
          tally.set(g, (tally.get(g) ?? 0) + 1);
        }
      }
      clusterInfo = Array.from(sizeByCluster.entries())
        .map(([cid, count]) => {
          const tally = tagsByCluster.get(cid);
          let topTag = "—";
          let topCount = 0;
          if (tally) {
            for (const [tag, c] of tally) {
              if (c > topCount) {
                topCount = c;
                topTag = tag;
              }
            }
          }
          return {
            label: topTag,
            color: clusterColor(cid),
            count,
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
    }

    return { graph: { nodes, links }, clusterOverride, clusterInfo };
  }, [rawGraph, libCriteria]);

  // Lazy co-play matrix — built once when the user first opens the overlay,
  // then cached for the lifetime of this Starfield mount. ~150ms for 50k
  // plays in a benchmark, so we don't precompute on load.
  const coplayMatrix = useMemo<CoplayMatrix | null>(() => {
    if (!showCoPlay || !plays || plays.length === 0) return null;
    return computeCoplayMatrix(plays);
  }, [showCoPlay, plays]);

  const coplayedForSelected = useMemo(() => {
    if (!coplayMatrix || !selected) return [];
    const top = topCoplayed(coplayMatrix, selected.id, 8);
    if (!graph) return [];
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return top
      .map(({ id, count }) => ({ node: byId.get(id), count }))
      .filter((x): x is { node: GraphNode; count: number } => !!x.node);
  }, [coplayMatrix, selected, graph]);

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
  // Pauses while the tab is hidden — no point polling the constellation
  // when nobody's watching it.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (typeof document !== "undefined" && document.hidden) return;
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
              uri: data.track.uri,
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
          } else if (data?.rateLimited) {
            // Spotify is briefly throttling /me/player/currently-playing.
            // Don't drop the halo — the next tick will re-fetch. Matches
            // NowPlaying.tsx's same-snap behavior so the constellation
            // doesn't flicker the highlight off mid-song.
          } else {
            setCurrentTrack(null);
          }
        }
      } catch {
        // swallow — next tick will retry
      }
      if (!cancelled) timer = setTimeout(tick, NOW_PLAYING_POLL_MS);
    }

    function onVisibility() {
      if (cancelled) return;
      if (document.hidden) {
        if (timer) clearTimeout(timer);
        timer = undefined;
      } else {
        if (timer) clearTimeout(timer);
        tick();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Match the current track against the graph. We compute every plausible
  // ID form so a single node lookup works for any data source / node type:
  //   - Spotify artist ID (API artist nodes)
  //   - lib:{lowercase_name} (library artist nodes)
  //   - spotify:track:... (library track nodes when we have the URI)
  //   - track:{name}::{artist} (library track nodes without URI)
  const currentArtistIds = useMemo(() => {
    const keys = new Set<string>();
    if (!currentTrack) return keys;
    for (const a of currentTrack.artists) {
      if (a.id) keys.add(a.id);
      if (a.name) keys.add(`lib:${a.name.toLowerCase()}`);
    }
    if (currentTrack.uri) keys.add(currentTrack.uri);
    if (currentTrack.name && currentTrack.artists[0]?.name) {
      keys.add(
        `track:${currentTrack.name.toLowerCase()}::${currentTrack.artists[0].name.toLowerCase()}`,
      );
    }
    return keys;
  }, [currentTrack]);

  const matchedNode = useMemo(
    () => graph?.nodes.find((n) => currentArtistIds.has(n.id)) ?? null,
    [graph, currentArtistIds],
  );

  // O(1) node lookup by ID — used by linkColor while d3-force is still
  // resolving link source/target from string IDs into node refs (the first
  // few frames after a graph swap).
  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    if (graph) for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph]);

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

    const matchedVal = matchedNode.size * 2.5;
    const NODE_REL_SIZE = 10;
    const renderedRadius = NODE_REL_SIZE * Math.cbrt(matchedVal);

    // Inner pulse — sharp, close-in glow visible at any zoom. Drop sphere
    // tessellation on low-power devices: at this radius/opacity, 16-segment
    // and 32-segment look nearly identical but the 16-segment version uses
    // ~1/4 the vertices, freeing the GPU for the rest of the graph.
    const innerSegments = lowPower ? 16 : 32;
    const inner = new Mesh(
      new SphereGeometry(renderedRadius * 2.2, innerSegments, innerSegments),
      new MeshBasicMaterial({
        color: 0x1ed760,
        transparent: true,
        opacity: 0.45,
        side: BackSide,
        depthWrite: false,
      }),
    );
    inner.name = "now-playing-halo-inner";
    inner.raycast = () => {};
    scene.add(inner);

    // Outer beacon — much larger, very faint glow that stays visible when
    // the camera is zoomed out far. Skipped on low-power devices: the
    // additional draw call + transparent overdraw is the expensive part,
    // not the geometry.
    const outer = lowPower
      ? null
      : new Mesh(
          new SphereGeometry(renderedRadius * 8, 24, 24),
          new MeshBasicMaterial({
            color: 0x1ed760,
            transparent: true,
            opacity: 0.15,
            side: BackSide,
            depthWrite: false,
          }),
        );
    if (outer) {
      outer.name = "now-playing-halo-outer";
      outer.raycast = () => {};
      scene.add(outer);
    }

    let rafId = 0;
    let cancelled = false;
    const animate = () => {
      if (cancelled) return;
      // Pause when the tab is hidden — RAF already throttles to ~1Hz in
      // background tabs but we have nothing useful to update there.
      if (typeof document !== "undefined" && document.hidden) {
        rafId = requestAnimationFrame(animate);
        return;
      }
      const t = Date.now() / 350;
      const sinT = Math.sin(t);
      // Inner pulses in scale + opacity for the "close-up" beat.
      inner.scale.setScalar(1.0 + 0.35 * sinT);
      (inner.material as MeshBasicMaterial).opacity =
        0.3 + 0.25 * (0.5 + 0.5 * sinT);
      // Outer breathes more slowly and stays soft for distant visibility.
      if (outer) {
        outer.scale.setScalar(0.9 + 0.25 * Math.sin(t * 0.6));
        (outer.material as MeshBasicMaterial).opacity =
          0.1 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.6));
      }

      const positioned = matchedNode as GraphNode & {
        x?: number;
        y?: number;
        z?: number;
      };
      const x = positioned.x ?? 0;
      const y = positioned.y ?? 0;
      const z = positioned.z ?? 0;
      inner.position.set(x, y, z);
      if (outer) outer.position.set(x, y, z);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      scene.remove(inner);
      inner.geometry.dispose();
      (inner.material as Material).dispose();
      if (outer) {
        scene.remove(outer);
        outer.geometry.dispose();
        (outer.material as Material).dispose();
      }
    };
  }, [graph, matchedNode, lowPower]);

  // Re-bind controls whenever a fresh graph mounts: left-drag pans the view,
  // right-drag rotates, scroll zooms. Native trackball-style "rotate on left"
  // felt unintuitive for browsing a 2D-ish starfield.
  useEffect(() => {
    if (!graph) return;
    const id = setTimeout(() => {
      const controls = graphRef.current?.controls?.();
      if (!controls?.mouseButtons) return;
      controls.mouseButtons = {
        LEFT: MOUSE.PAN,
        MIDDLE: MOUSE.DOLLY,
        RIGHT: MOUSE.ROTATE,
      };
      // Match the same gestures for touch devices.
      if (controls.touches) {
        controls.touches = {
          ONE: TOUCH.PAN,
          TWO: TOUCH.DOLLY_ROTATE,
        };
      }
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
    }, 0);
    return () => clearTimeout(id);
  }, [graph]);

  // Spread the cluster out: bump link distance + node repulsion. Applied
  // via onEngineTick (rather than a useEffect) so we *know* the simulation
  // is alive — tuning forces before the engine is built was crashing with
  // "Cannot read properties of undefined (reading 'tick')".
  const tunedForGraphRef = useRef<{
    nodes: GraphNode[];
    links: GraphLink[];
  } | null>(null);
  useEffect(() => {
    tunedForGraphRef.current = null;
  }, [graph]);

  const tuneForcesOnce = () => {
    if (!graph || tunedForGraphRef.current === graph) return;
    const fg = graphRef.current;
    const linkForce = fg?.d3Force?.("link");
    const chargeForce = fg?.d3Force?.("charge");
    if (!linkForce || !chargeForce) return;

    const n = graph.nodes.length;
    // Compact tuning — pull connected nodes tighter and dampen long-range
    // repulsion so clusters stay packed. Values are roughly half the
    // previous spread; ~sqrt(n) growth keeps larger libraries from
    // collapsing into a single ball.
    const linkDistance = Math.round(140 + Math.sqrt(n) * 18);
    const chargeStrength = -(380 + n * 5);
    try {
      linkForce.distance(linkDistance);
      if (typeof linkForce.strength === "function") {
        // Stronger spring → connected nodes pull in tighter.
        linkForce.strength(0.32);
      }
      chargeForce.strength(chargeStrength);
      // Cap repulsion reach so distant clusters don't push each other
      // apart across the canvas.
      if (typeof chargeForce.distanceMax === "function") {
        chargeForce.distanceMax(550);
      }
      // Stronger centering so the constellation occupies a smaller
      // volume — keeps it readable without zooming.
      const centerForce = fg.d3Force?.("center");
      if (centerForce && typeof centerForce.strength === "function") {
        centerForce.strength(0.85);
      }
      tunedForGraphRef.current = graph;
    } catch {
      // Engine state mid-transition; let the next tick retry.
    }
  };

  // Inject a real starfield (THREE.Points) into the underlying scene so the
  // background isn't just flat black. On first load ForceGraph3D's scene
  // isn't ready yet (it's dynamic-imported and async-initialized), so we
  // retry on a short interval until scene() resolves.
  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 60; // ~3s worth of retries

    const tryAdd = () => {
      if (cancelled) return;
      const scene = graphRef.current?.scene?.();
      if (scene) {
        if (!scene.getObjectByName("starfield")) {
          const stars = createStarfield(lowPower);
          stars.name = "starfield";
          scene.add(stars);
        }
        const camera = graphRef.current?.camera?.();
        if (camera && camera.far < 5000) {
          camera.far = 5000;
          camera.updateProjectionMatrix();
        }
        return;
      }
      if (++attempts < maxAttempts) {
        setTimeout(tryAdd, 50);
      }
    };
    tryAdd();

    return () => {
      cancelled = true;
    };
  }, [graph, lowPower]);

  const detail = selected ?? hovered;
  // Memoize the genre tally so we don't recompute on every render — it
  // only changes when the displayed graph changes.
  const genreCounts = useMemo(
    () => (graph ? topGenres(graph.nodes) : []),
    [graph],
  );

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
            // Now-playing node keeps its native genre/cluster color — the
            // halo + size scale-up are sufficient highlight without losing
            // its position in the colormap.
            return clusterOverride?.get(node.id) ?? node.color;
          }}
          nodeVal={(n: object) => {
            const node = n as GraphNode;
            return currentArtistIds.has(node.id) ? node.size * 2.5 : node.size;
          }}
          nodeOpacity={1}
          // nodeRelSize is the visual scale multiplier — radius = nodeRelSize
          // × cbrt(nodeVal). Default 4 was too small; 10 makes nodes feel
          // properly weighted in the scene.
          nodeRelSize={10}
          // Sphere segment count: 24 on desktop for smooth shading, 14 on
          // low-power devices to avoid mobile-GPU jank with 150+ nodes.
          nodeResolution={lowPower ? 14 : 24}
          linkColor={(l: object) => {
            // Source/target may be string IDs (early frames before d3-force
            // resolves them) or full node refs (after). Resolve via the
            // nodeById map so edges paint with the right cluster color from
            // frame 1 instead of starting white and recoloring 5s later.
            const link = l as { source: GraphNode | string };
            const source =
              typeof link.source === "object"
                ? link.source
                : nodeById.get(link.source);
            if (!source) return "rgba(255,255,255,0.45)";
            return clusterOverride?.get(source.id) ?? source.color;
          }}
          linkOpacity={0.55}
          linkWidth={(l: object) => {
            const link = l as GraphLink;
            // Width by Jaccard similarity (0.35..1.0) → 1.5..4 px range.
            return 1.5 + link.jaccard * 2.5;
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
          onEngineTick={tuneForcesOnce}
        />
        </div>
      )}

      {detail && (
        <NodeDetails
          node={detail}
          pinned={!!selected}
          onClose={() => setSelected(null)}
          coplayed={selected && detail.id === selected.id ? coplayedForSelected : []}
          onCoplayedSelect={(n) => {
            setSelected(n);
            if (graphRef.current) focusOnNode(graphRef.current, n);
          }}
        />
      )}

      {graph &&
        (clusterInfo && clusterInfo.length > 0 ? (
          <ColorLegend title="Clusters" items={clusterInfo} />
        ) : genreCounts.length > 0 ? (
          <ColorLegend
            title="Top genres"
            items={genreCounts.map((c) => ({
              label: c.genre,
              color: c.color,
              count: c.count,
            }))}
          />
        ) : null)}

      {graph && (
        <NodeList
          nodes={graph.nodes}
          selectedId={selected?.id}
          onSelect={(n) => {
            setSelected(n);
            if (graphRef.current) focusOnNode(graphRef.current, n);
          }}
          sortLabel={
            libCriteria
              ? libCriteria.sortBy === "msPlayed"
                ? "Total time"
                : "Total plays"
              : criteria.kind === "api"
                ? "Spotify rank"
                : undefined
          }
        />
      )}

      {rawGraph && libCriteria && onCriteriaChange && (
        <TagsPanel
          rawNodes={rawGraph.nodes}
          criteria={libCriteria}
          onChange={(next) => onCriteriaChange(next)}
          showCoPlay={showCoPlay}
          onShowCoPlayChange={setShowCoPlay}
        />
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

function createStarfield(lowPower: boolean): Group {
  const group = new Group();
  // Halve the star count on low-power devices — the visual loss is barely
  // perceptible at 2000m radius, but mobile GPUs love it.
  const m = lowPower ? 0.4 : 1;
  group.add(makeStarLayer(Math.round(700 * m), 2.0, 0.95, 0xffffff));
  group.add(makeStarLayer(Math.round(1500 * m), 1.2, 0.7, 0xeaf2ff));
  group.add(makeStarLayer(Math.round(3000 * m), 0.7, 0.4, 0xc0d0ff));
  return group;
}

function makeStarLayer(
  count: number,
  size: number,
  opacity: number,
  color: number,
): Points {
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
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color,
    size,
    transparent: true,
    opacity,
    sizeAttenuation: false,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
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
  const clickable = matched && !!onFocus;
  const handleClick = clickable ? onFocus : undefined;
  return (
    <div
      onClick={handleClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onFocus();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={
        clickable ? `Focus on ${matchedNodeName ?? "match"}` : undefined
      }
      className={`absolute bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-2xl border bg-black/85 p-3 backdrop-blur-xl transition-all ${
        matched
          ? "cursor-pointer border-[var(--brand)]/40 shadow-[0_0_30px_-8px_rgba(30,215,96,0.5)] hover:scale-[1.02] hover:border-[var(--brand)]/70 hover:shadow-[0_0_40px_-6px_rgba(30,215,96,0.7)] active:scale-[0.99]"
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
          <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--brand)]">
            ✦ In graph — click to focus on {matchedNodeName ?? "match"}
          </div>
        ) : (
          <div className="mt-1.5 text-[10px] uppercase tracking-wider text-[var(--subtle)]">
            Not in current view
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
  coplayed,
  onCoplayedSelect,
}: {
  node: GraphNode;
  pinned: boolean;
  onClose: () => void;
  coplayed: { node: GraphNode; count: number }[];
  onCoplayedSelect: (n: GraphNode) => void;
}) {
  const isTrack = !!node.artistName;
  const myHours =
    typeof node.myMsPlayed === "number"
      ? node.myMsPlayed / 1000 / 60 / 60
      : 0;

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
            className={`h-14 w-14 flex-shrink-0 ${
              isTrack ? "rounded-md" : "rounded-full"
            }`}
            style={{ background: node.color }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--brand)]">
            {isTrack ? "Track" : "Artist"} · #{node.rank}
          </div>
          <div className="truncate text-base font-bold text-white">
            {node.name}
          </div>
          {isTrack ? (
            <div className="truncate text-xs text-[var(--muted)]">
              {node.artistName}
              {node.albumName ? ` · ${node.albumName}` : ""}
            </div>
          ) : (
            <div className="text-xs capitalize text-[var(--muted)]">
              {node.primaryGenre}
            </div>
          )}
          {isTrack && (node.myPlayCount ?? 0) > 0 && (
            <div className="mt-1 flex gap-3 text-[10px] tabular-nums text-[var(--subtle)]">
              <span>{node.myPlayCount} plays</span>
              <span>
                {myHours >= 1
                  ? `${myHours.toFixed(1)} hrs`
                  : `${Math.round((node.myMsPlayed ?? 0) / 60000)} min`}
              </span>
            </div>
          )}
          {!isTrack && (node.listeners > 0 || node.playcount > 0) && (
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
      {coplayed.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--brand)]">
            Often co-played with
          </div>
          <ul className="flex flex-col gap-0.5">
            {coplayed.slice(0, 5).map(({ node: n, count }) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => onCoplayedSelect(n)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/[0.06]"
                >
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: n.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white">
                    {n.name}
                    {n.artistName && (
                      <span className="text-[var(--muted)]"> · {n.artistName}</span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-[10px] tabular-nums text-[var(--subtle)]">
                    {count}×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <a
          href={spotifyUrlFor(node)}
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

function spotifyUrlFor(node: GraphNode): string {
  // Track node with a real Spotify URI — direct deep link.
  if (node.trackUri && node.trackUri.startsWith("spotify:track:")) {
    return `https://open.spotify.com/track/${node.trackUri.replace("spotify:track:", "")}`;
  }
  // Track node without URI — search for "track artist".
  if (node.artistName) {
    return `https://open.spotify.com/search/${encodeURIComponent(`${node.name} ${node.artistName}`)}`;
  }
  // Library artist (synthetic id) — search by name.
  if (node.id.startsWith("lib:")) {
    return `https://open.spotify.com/search/${encodeURIComponent(node.name)}`;
  }
  // API artist — direct deep link.
  return `https://open.spotify.com/artist/${node.id}`;
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

function ColorLegend({
  title,
  items,
}: {
  title: string;
  items: { label: string; count: number; color: string }[];
}) {
  return (
    <div className="overlay-card absolute bottom-4 left-4 flex flex-col gap-1.5 rounded-2xl border border-white/[0.08] px-4 py-3 text-[13px] backdrop-blur-md">
      <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/75">
        {title}
      </div>
      {items.map((c, i) => (
        <div key={`${c.label}-${i}`} className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: c.color }}
          />
          <span className="font-medium capitalize text-white">{c.label}</span>
          <span className="ml-auto font-semibold tabular-nums text-[var(--muted)]">
            {c.count}
          </span>
        </div>
      ))}
    </div>
  );
}
