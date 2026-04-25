import Link from "next/link";
import NowPlaying from "@/components/NowPlaying";
import ProfileBadge from "@/components/ProfileBadge";
import RecentlyPlayed from "@/components/RecentlyPlayed";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const errMsg = params.error ? decodeErrorMessage(params.error) : null;
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Aurora glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
      >
        <div className="aurora absolute -top-40 left-1/2 h-[55rem] w-[55rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,#1ed76055,transparent_70%)] blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(30,215,96,0.18),transparent_50%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/60 to-black" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-14 px-6 py-14 sm:px-10">
        {/* Top bar */}
        <nav className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <SpotifyMark />
            <span className="text-sm font-bold tracking-wide">
              Listening Web
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/explore"
              className="hidden text-sm font-medium text-[var(--muted)] transition-colors hover:text-white sm:inline"
            >
              Explore
            </Link>
            <Link
              href="/upload"
              className="hidden text-sm font-medium text-[var(--muted)] transition-colors hover:text-white sm:inline"
            >
              Upload
            </Link>
            <ProfileBadge />
          </div>
        </nav>

        {/* Hero */}
        <header className="flex flex-col gap-5 pt-8">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)] backdrop-blur">
            Personal · 7 years of plays
          </span>
          <h1 className="text-balance text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl">
            Your playlist,{" "}
            <span className="bg-gradient-to-br from-[var(--brand)] to-emerald-200 bg-clip-text text-transparent">
              as a starfield.
            </span>
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            A 3D starfield of every track you&apos;ve played, linked by genre
            and listening session. The song you&apos;re playing right now lights
            up the constellation.
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

        {/* Now playing card */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
            Now playing
          </h2>
          <NowPlaying />
        </section>

        {/* Recently played */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
            Recently played
          </h2>
          <RecentlyPlayed />
        </section>

        {/* Explore starfield CTA */}
        <section className="relative overflow-hidden rounded-2xl border border-[var(--brand)]/20 bg-gradient-to-br from-[var(--brand)]/[0.08] via-[var(--surface-elevated)] to-[var(--surface)] p-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full bg-[var(--brand)]/30 blur-3xl"
          />
          <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-md">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
                Phase 4 · Preview
              </div>
              <h3 className="mt-1 text-lg font-bold text-white">
                See your top artists in 3D
              </h3>
              <p className="mt-1 text-sm text-[var(--muted)]">
                A starfield of your top 50 artists, linked by shared genre.
                Real Spotify data, no upload needed.
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

        {/* Upload CTA */}
        <section className="flex flex-col items-start gap-4 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-[var(--surface-elevated)] to-[var(--surface)] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-md">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--brand)]">
              Phase 2
            </div>
            <h3 className="mt-1 text-lg font-bold text-white">
              Bring your history
            </h3>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Drop your Spotify data ZIP and we&apos;ll parse it into the
              constellation. Stays in your browser.
            </p>
          </div>
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition-transform hover:scale-[1.03] active:scale-[0.99]"
          >
            Upload data →
          </Link>
        </section>

        {/* Roadmap */}
        <section>
          <h2 className="mb-4 text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--muted)]">
            Build phases
          </h2>
          <ol className="grid gap-2 sm:grid-cols-2">
            <Phase n={1} done title="Connect & live now-playing">
              PKCE auth, polled every 5s.
            </Phase>
            <Phase n={2} done title="Upload streaming history">
              Extended history ZIP → parsed, deduped to unique tracks.
            </Phase>
            <Phase n={3} title="Enrich with genres">
              Artist genres + Last.fm similarity for cross-genre bridges.
            </Phase>
            <Phase n={4} done title="3D starfield render">
              Live on /explore — top 50 artists, edges by shared genre.
            </Phase>
            <Phase n={5} title="Real-time graph overlay">
              Current node pulses; recent session traces a path.
            </Phase>
            <Phase n={6} title="Polish">
              Filters, search, share links.
            </Phase>
          </ol>
        </section>

        <footer className="mt-auto pt-10 text-xs text-[var(--subtle)]">
          Personal project · Data stays in your session · Not affiliated with
          Spotify
        </footer>
      </main>
    </div>
  );
}

function Phase({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="group flex gap-4 rounded-xl border border-white/[0.06] bg-[var(--surface)] p-4 transition-colors hover:bg-[var(--surface-elevated)]">
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
          done
            ? "bg-[var(--brand)] text-black"
            : "bg-white/[0.06] text-[var(--muted)]"
        }`}
      >
        {done ? "✓" : n}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
          {children}
        </div>
      </div>
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
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

function SpotifyMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-7 w-7 text-[var(--brand)]"
      fill="currentColor"
    >
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.521 17.34a.748.748 0 0 1-1.03.249c-2.823-1.724-6.376-2.114-10.561-1.158a.748.748 0 1 1-.333-1.46c4.581-1.045 8.515-.594 11.676 1.34.351.214.464.674.248 1.029zm1.473-3.267a.935.935 0 0 1-1.286.308c-3.231-1.987-8.156-2.563-11.978-1.402a.935.935 0 1 1-.542-1.79c4.366-1.323 9.794-.679 13.498 1.598.44.27.582.847.308 1.286zm.13-3.403c-3.876-2.302-10.27-2.514-13.97-1.39a1.122 1.122 0 1 1-.65-2.148c4.244-1.286 11.302-1.038 15.764 1.612.534.317.71 1.008.394 1.541a1.122 1.122 0 0 1-1.538.385z" />
    </svg>
  );
}
