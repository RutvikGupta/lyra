import Link from "next/link";
import UploadZone from "@/components/UploadZone";

export default function UploadPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
      >
        <div className="aurora absolute -top-40 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,#1ed76055,transparent_70%)] blur-3xl" />
      </div>

      <main className="relative mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-10 px-6 py-14 sm:px-10">
        <nav className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm font-medium text-[var(--muted)] transition-colors hover:text-white"
          >
            ← Listening Web
          </Link>
          <span className="text-xs uppercase tracking-[0.18em] text-[var(--subtle)]">
            Phase 2 · Your data
          </span>
        </nav>

        <header className="flex flex-col gap-3">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)] backdrop-blur">
            Local · Private
          </span>
          <h1 className="text-balance text-4xl font-black leading-[0.95] tracking-tight sm:text-5xl">
            Upload your{" "}
            <span className="bg-gradient-to-br from-[var(--brand)] to-emerald-200 bg-clip-text text-transparent">
              listening history
            </span>
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-[var(--muted)]">
            Drop the ZIP Spotify emailed you (or the JSON files inside it).
            Parsing happens entirely in your browser — your data never leaves
            this tab.
          </p>
        </header>

        <UploadZone />
      </main>
    </div>
  );
}
