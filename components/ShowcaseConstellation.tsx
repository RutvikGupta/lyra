import Link from "next/link";
import {
  enrichArtists,
  fetchShowcaseProfile,
  fetchShowcaseTopArtists,
} from "@/lib/spotify-api";
import {
  showcaseConfigured,
  withShowcaseCache,
} from "@/lib/spotify-showcase";

// Server component. Renders the owner's actual top artists as a tile grid
// preview, with a CTA into /explore (which loads the full 3D constellation
// — also driven by the same showcase fallback).
//
// Hidden when SHOWCASE_REFRESH_TOKEN isn't set, so a fork that hasn't
// configured showcase mode doesn't show a broken-looking section.

const TTL_MS = 60 * 60_000; // 1h — same as /api/showcase/top-artists

type Tile = {
  id: string;
  name: string;
  image: string | null;
  genres: string[];
};

type Showcase = {
  ownerName: string | null;
  ownerImage: string | null;
  tiles: Tile[];
  totalArtists: number;
  uniqueGenres: number;
};

async function loadShowcase(): Promise<Showcase | null> {
  if (!showcaseConfigured()) return null;

  return withShowcaseCache("home-constellation", TTL_MS, async () => {
    const [profile, top] = await Promise.all([
      fetchShowcaseProfile(),
      fetchShowcaseTopArtists("long_term", 30),
    ]);
    if (!top) {
      return {
        ownerName: profile?.display_name ?? null,
        ownerImage: profile?.images?.[0]?.url ?? null,
        tiles: [],
        totalArtists: 0,
        uniqueGenres: 0,
      } satisfies Showcase;
    }
    const enriched = await enrichArtists(top.items);
    const genreSet = new Set<string>();
    for (const a of enriched) {
      for (const g of a.genres ?? []) genreSet.add(g.toLowerCase());
    }
    return {
      ownerName: profile?.display_name ?? null,
      ownerImage: profile?.images?.[0]?.url ?? null,
      tiles: enriched.slice(0, 12).map((a) => ({
        id: a.id,
        name: a.name,
        image: a.images?.[0]?.url ?? null,
        genres: Array.isArray(a.genres) ? a.genres : [],
      })),
      totalArtists: enriched.length,
      uniqueGenres: genreSet.size,
    } satisfies Showcase;
  });
}

export default async function ShowcaseConstellation() {
  const data = await loadShowcase();
  if (!data) return null;

  const { ownerName, ownerImage, tiles, totalArtists, uniqueGenres } = data;
  const heading = ownerName ? `${ownerName}'s constellation` : "Live constellation";

  return (
    <section className="relative overflow-hidden rounded-2xl border border-[var(--brand)]/20 bg-gradient-to-br from-[var(--brand)]/[0.08] via-[var(--surface-elevated)] to-[var(--surface)] p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-[var(--brand)]/30 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-0 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {ownerImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ownerImage}
                alt=""
                className="h-10 w-10 flex-shrink-0 rounded-full border border-white/10"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--brand)]/15 text-[var(--brand)]"
              >
                ✦
              </span>
            )}
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                Showcase
              </div>
              <h3 className="text-lg font-bold text-white">{heading}</h3>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-black transition-transform hover:scale-[1.03] active:scale-[0.99]"
            >
              Top artists →
            </Link>
            <Link
              href="/library"
              className="inline-flex items-center gap-2 rounded-full border border-[var(--brand)]/40 bg-[var(--brand)]/[0.08] px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[var(--brand)]/[0.16]"
            >
              Top streams →
            </Link>
          </div>
        </div>

        <p className="max-w-xl text-sm text-[var(--muted)]">
          You&apos;re viewing{" "}
          <span className="font-semibold text-white">
            {ownerName ?? "kivtur00"}&apos;s
          </span>{" "}
          listening data — top {totalArtists || 50} artists across{" "}
          {uniqueGenres || "many"} genre clusters, plus a track-level
          constellation built from {ownerName ?? "kivtur00"}&apos;s full
          streaming history.
        </p>

        {tiles.length > 0 && (
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-12">
            {tiles.map((t, i) => (
              <div
                key={t.id}
                className="group relative aspect-square overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.04]"
                title={t.name}
              >
                {t.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.image}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-base text-[var(--subtle)]">
                    ♫
                  </div>
                )}
                <span
                  aria-hidden
                  className="absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)] opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ transitionDelay: `${i * 12}ms` }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
