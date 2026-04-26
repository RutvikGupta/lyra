import ExploreView from "@/components/ExploreView";
import RateLimitChip from "@/components/RateLimitChip";
import ShowcaseOwnerBanner from "@/components/ShowcaseOwnerBanner";
import SoftLink from "@/components/SoftLink";

export default function ExplorePage() {
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
      <ShowcaseOwnerBanner scope="explore" />
      <ExploreView share={{ mode: "artists" }} />
      <RateLimitChip />
    </div>
  );
}
