import Link from "next/link";
import ExploreView from "@/components/ExploreView";

export default function LibraryPage() {
  return (
    <div className="relative h-screen overflow-hidden bg-black text-white">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-5 sm:p-6">
        <Link
          href="/"
          className="text-sm font-medium text-[var(--muted)] transition-colors hover:text-white"
        >
          ← Listening Web
        </Link>
        <div className="rounded-full border border-white/10 bg-black/60 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] backdrop-blur">
          Phase 4 · Your library
        </div>
      </header>
      <ExploreView
        initialCriteria={{
          kind: "library",
          year: "all",
          sortBy: "msPlayed",
          limit: 150,
        }}
      />
    </div>
  );
}
