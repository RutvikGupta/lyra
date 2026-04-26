import ExploreView from "@/components/ExploreView";
import PublishShowcaseButton from "@/components/PublishShowcaseButton";
import ShowcaseOwnerBanner from "@/components/ShowcaseOwnerBanner";
import SoftLink from "@/components/SoftLink";

export default function LibraryPage() {
  return (
    <div className="relative h-screen overflow-hidden bg-black text-white">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center p-5 sm:p-6">
        <SoftLink
          href="/"
          className="overlay-tab inline-flex items-center gap-1 rounded-full border border-white/10 px-3.5 py-2 text-[13px] font-bold text-white/85 backdrop-blur-md transition-colors hover:text-white"
        >
          ← Lyra
        </SoftLink>
      </header>
      <ShowcaseOwnerBanner scope="library" />
      {/* Owner-only Publish — pinned next to ← Lyra in the top-left.
          Hidden for visitors (where the banner takes this slot). The
          Share button is rendered by ExploreView itself in the
          top-right corner so it never collides with the banner. */}
      <div className="pointer-events-none absolute left-20 top-5 z-30 flex flex-wrap items-start gap-2 sm:left-28 sm:top-6">
        <PublishShowcaseButton />
      </div>
      <ExploreView
        share={{ mode: "library" }}
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
