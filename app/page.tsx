import Link from "next/link";
import NowPlaying from "@/components/NowPlaying";
import ProfileBadge from "@/components/ProfileBadge";
import RateLimitChip from "@/components/RateLimitChip";
import RecentlyPlayed from "@/components/RecentlyPlayed";
import ShowcaseConstellation from "@/components/ShowcaseConstellation";
import TopArtists from "@/components/TopArtists";
import { hasAuthSession } from "@/lib/spotify";

// Belt-and-suspenders against Vercel CDN serving a cached pre-OAuth
// render of the page. The await on hasAuthSession() should already
// mark this dynamic, but force-dynamic guarantees no caching layer
// can short-circuit the auth-conditional rendering.
export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const errMsg = params.error ? decodeErrorMessage(params.error) : null;
  const authed = await hasAuthSession();
  return (
    <div className="relative min-h-screen overflow-hidden text-white">
      <RateLimitChip />
      {/* Animated aurora layered on top of the body gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="aurora absolute -top-40 left-1/2 h-[55rem] w-[55rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,#1ed76066,transparent_70%)] blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-10 px-5 pb-10 pt-6 sm:gap-14 sm:px-10 sm:pb-14 sm:pt-10">
        {/* Wordmark band — Lyra brand gets its own header row, big and
            uncluttered. Nav links sit below in their own row. */}
        <div className="flex items-center justify-between gap-4">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3 sm:gap-4"
            aria-label="Lyra home"
          >
            <LyraMark />
            <span className="lyra-wordmark text-5xl leading-[1.1] text-white sm:text-6xl md:text-7xl">
              Lyra
            </span>
          </Link>
          <ProfileBadge />
        </div>

        {/* Secondary nav */}
        <nav className="flex items-center gap-5 text-sm font-medium text-[var(--muted)]">
          <Link
            href="/explore"
            className="transition-colors hover:text-white"
          >
            Explore
          </Link>
          <Link
            href="/library"
            className="transition-colors hover:text-white"
          >
            Library
          </Link>
          <Link
            href="/upload"
            className="transition-colors hover:text-white"
          >
            Upload
          </Link>
        </nav>

        {/* Hero */}
        <header className="flex flex-col gap-5">
          <h1 className="text-balance text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl sm:leading-[1] md:text-6xl xl:text-7xl">
            Your playlist,{" "}
            <span className="bg-gradient-to-br from-[var(--brand)] to-emerald-200 bg-clip-text text-transparent">
              Visualized in
            </span>{" "}
            <span aria-label="3D" className="text-3d">
              3D
            </span>
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Every track you&apos;ve played, artist you listened to, plotted
            in a 3D web and interlinked by shared genre. Pulsates the song
            or artist you are listening to currently.
          </p>
        </header>

        {/* Auth error banner */}
        {errMsg && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/[0.08] px-4 py-3 text-sm">
            <div className="font-semibold text-red-200">
              Spotify connect failed
            </div>
            <div className="mt-1 text-red-200/80">{errMsg}</div>
            <a
              href="/api/auth/login"
              className="mt-2 inline-block text-xs font-medium text-[var(--brand)] underline hover:no-underline"
            >
              Try again
            </a>
          </div>
        )}

        {/* Showcase constellation — the owner's actual top artists, with a
            link into the full 3D view. Server-rendered; hidden if showcase
            mode isn't configured. */}
        <ShowcaseConstellation />

        {/* Attribution for unauthed visitors — the live cards below show
            kivtur00's data via the showcase fallback, not the visitor's
            until they Connect Spotify. */}
        {!authed && (
          <div className="-mb-4 flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-[var(--muted)]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand)]" />
            Cards below show kivtur00&apos;s top listens — Connect Spotify
            above to see yours.
          </div>
        )}

        {/* Now playing — owner/visitor only when signed in. We don't
            broadcast the owner's currently-playing track to anonymous
            visitors anymore, so this section disappears entirely until
            the visitor connects their own Spotify. */}
        {authed && (
          <section className="flex flex-col gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
              Now playing
            </h2>
            <NowPlaying />
          </section>
        )}

        {/* Recently played */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
            Recently played
          </h2>
          <RecentlyPlayed />
        </section>

        {/* Top artists */}
        <section>
          <TopArtists />
        </section>

        {/* Authed-only fast-path CTA. Visitors who haven't connected don't
            need a "see yours" link — they have the Showcase above + the
            Connect button in the header. Once signed in, surface the
            shortcut into their own constellation. */}
        {authed && (
          <section className="relative overflow-hidden rounded-2xl border border-[var(--brand)]/20 bg-gradient-to-br from-[var(--brand)]/[0.08] via-[var(--surface-elevated)] to-[var(--surface)] p-6">
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-[var(--brand)]/30 blur-3xl"
            />
            <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-md">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                  Your turn · fast path
                </div>
                <h3 className="mt-1 text-lg font-bold text-white">
                  See your top artists in 3D
                </h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Your top 50 artists as a starfield, linked by shared genre.
                  No upload needed — built from your live Spotify data.
                </p>
              </div>
              <Link
                href="/explore"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-black transition-transform hover:scale-[1.03] active:scale-[0.99]"
              >
                Open starfield →
              </Link>
            </div>
          </section>
        )}

        {/* Upload CTA — step-by-step because the Spotify ZIP request flow
            is a 30-day async loop people forget about, and "where's the
            ZIP?" is the most common question on first encounter. */}
        <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[var(--surface-elevated)] to-[var(--surface)] p-6">
          <div className="flex flex-col gap-1">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
              Your turn · deep path
            </div>
            <h3 className="text-lg font-bold text-white">
              Bring your full history
            </h3>
            <p className="text-sm text-[var(--muted)]">
              Spotify lets you request your full play history as a ZIP.
              Parsing happens entirely in your browser — your data never
              leaves this tab.
            </p>
          </div>

          <ol className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <Step n={1} title="Request the ZIP">
              Open{" "}
              <a
                href="https://www.spotify.com/account/privacy/"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[var(--brand)] underline-offset-4 hover:underline"
              >
                spotify.com/account/privacy
              </a>{" "}
              and tick <span className="font-medium text-white">Extended
              streaming history</span>, then click{" "}
              <span className="font-medium text-white">Request data</span>.
            </Step>
            <Step n={2} title="Confirm + wait">
              Spotify emails a confirmation link — click it. The ZIP arrives
              by email <span className="font-medium text-white">within
              ~30 days</span> (usually a few days).
            </Step>
            <Step n={3} title="Drop it here">
              Unzip not required. Drag the ZIP onto the upload page — Lyra
              parses it locally and renders your constellation.
            </Step>
          </ol>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href="/upload"
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition-transform hover:scale-[1.03] active:scale-[0.99]"
            >
              Upload ZIP →
            </Link>
            <a
              href="https://www.spotify.com/account/privacy/"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-[var(--muted)] transition-colors hover:text-white"
            >
              Open Spotify privacy page ↗
            </a>
          </div>
        </section>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-10 text-xs text-[var(--subtle)]">
          <span>Lyra © 2026 · Built in Toronto by kivtur00</span>
          <span>Not affiliated with Spotify</span>
        </footer>
      </main>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border border-white/[0.06] bg-[var(--surface)] p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--brand)]/15 text-[11px] font-bold text-[var(--brand)]">
          {n}
        </span>
        <span className="text-[13px] font-bold text-white">{title}</span>
      </div>
      <p className="text-[12px] leading-relaxed text-[var(--muted)]">
        {children}
      </p>
    </li>
  );
}

function decodeErrorMessage(raw: string): string {
  if (raw === "invalid_callback") {
    return "PKCE state didn't match — usually means the cookie was set on a different host (localhost vs 127.0.0.1). Clear cookies and try again at http://127.0.0.1:3000.";
  }
  if (raw === "access_denied") {
    return "You declined the Spotify permissions request.";
  }
  if (raw === "not_on_allowlist") {
    return "Spotify accepted the login, but your account isn't on the dev app's allowlist — every API call returns 403. Add your Spotify email under your developer dashboard → app → User Management, then try again.";
  }
  if (raw === "token_invalid") {
    return "Spotify returned a token that doesn't authenticate. Try again — if it persists, the dev app may need to be re-created.";
  }
  if (raw === "verify_429") {
    return "Spotify is rate-limiting auth requests on your account (too many recent logins). Wait ~15–30 minutes, then try again. The token they issued is fine — they're just throttling /me checks.";
  }
  if (raw.startsWith("verify_")) {
    return `Spotify API verification failed (HTTP ${raw.slice(7)}). Try again; if it persists, your account may not have access to the dev app.`;
  }
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

function LyraMark() {
  // Stylized rendering of the Lyra constellation: Vega (the brightest star
  // in the night sky) at top, with the harp-shaped parallelogram of Beta,
  // Gamma, Delta, Zeta Lyrae below — connected by faint stick-figure lines
  // the way star charts draw it.
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-12 w-12 flex-shrink-0 overflow-visible text-[var(--brand)] sm:h-14 sm:w-14 md:h-16 md:w-16"
      fill="currentColor"
    >
      <g
        stroke="currentColor"
        strokeWidth="0.7"
        strokeLinecap="round"
        opacity="0.45"
        fill="none"
      >
        <line x1="12" y1="3" x2="7.5" y2="9.5" />
        <line x1="7.5" y1="9.5" x2="16.5" y2="9.5" />
        <line x1="7.5" y1="9.5" x2="9" y2="19" />
        <line x1="16.5" y1="9.5" x2="15" y2="19" />
        <line x1="9" y1="19" x2="15" y2="19" />
      </g>
      {/* Vega — brightest star, with a soft halo. Pulses softly. */}
      <g className="vega-pulse">
        <circle cx="12" cy="3" r="5" opacity="0.18" />
        <circle cx="12" cy="3" r="3.6" opacity="0.3" />
        <circle cx="12" cy="3" r="2.3" />
      </g>
      {/* Parallelogram of the lyre */}
      <circle cx="7.5" cy="9.5" r="1.3" />
      <circle cx="16.5" cy="9.5" r="1.3" />
      <circle cx="9" cy="19" r="1.1" />
      <circle cx="15" cy="19" r="1.1" />
    </svg>
  );
}
