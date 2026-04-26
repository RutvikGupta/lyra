import Link from "next/link";
import ExploreView from "@/components/ExploreView";
import PublishShowcaseButton from "@/components/PublishShowcaseButton";
import ShareConstellationButton from "@/components/ShareConstellationButton";
import ShowcaseOwnerBanner from "@/components/ShowcaseOwnerBanner";

export default function LibraryPage() {
  return (
    <div className="relative h-screen overflow-hidden bg-black text-white">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center p-5 sm:p-6">
        <Link
          href="/"
          className="overlay-tab inline-flex items-center gap-1 rounded-full border border-white/10 px-3.5 py-2 text-[13px] font-bold text-white/85 backdrop-blur-md transition-colors hover:text-white"
        >
          ← Lyra
        </Link>
      </header>
      <ShowcaseOwnerBanner scope="library" />
      {/* Owner / library-creator controls — pinned next to ← Lyra in
          the top-left so they don't overlap node-info or the source
          toggle on narrow screens. Wraps to a column when both are
          present and the viewport is too tight for a single row. */}
      <div className="pointer-events-none absolute left-20 top-5 z-30 flex flex-wrap items-start gap-2 sm:left-28 sm:top-6">
        <PublishShowcaseButton />
        <ShareConstellationButton />
      </div>
      <ExploreView
        initialCriteria={{
          kind: "library",
          nodeType: "tracks",
          year: "all",
          sortBy: "msPlayed",
          limit: 150,
          timeOfDay: [],
          dayOfWeek: "all",
          sessionEntry: "all",
          lovedOnly: false,
          skipBucket: "any",
          discoveryYear: "all",
          tags: [],
          colorMode: "genre",
          moods: [],
        }}
      />
    </div>
  );
}
