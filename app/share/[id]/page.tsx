import { notFound } from "next/navigation";
import SharedConstellation from "@/components/SharedConstellation";
import SoftLink from "@/components/SoftLink";
import { isValidShareId } from "@/lib/share-id";
import { readShare } from "@/lib/share-store";

export default async function SharePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isValidShareId(id)) notFound();

  const snap = await readShare(id);
  if (!snap) notFound();

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

      {/* Subject chip — same shape as ShowcaseOwnerBanner so visitors
          immediately see whose constellation they're looking at. */}
      <div
        className="overlay-tab pointer-events-auto absolute left-20 top-5 z-40 flex max-w-[calc(50vw-7rem)] items-center gap-2 truncate rounded-full border border-white/10 px-3.5 py-1.5 text-[11px] font-semibold text-white/85 backdrop-blur-md sm:left-28 sm:top-6"
        role="status"
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--brand)]"
        />
        <span className="truncate">
          {snap.ownerName}&apos;s shared constellation
        </span>
      </div>

      <SharedConstellation snapshot={snap} />
    </div>
  );
}
