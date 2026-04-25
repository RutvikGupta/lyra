"use client";

import { useEffect, useState } from "react";

type Profile = {
  authenticated: boolean;
  name?: string;
  image?: string | null;
  profileUrl?: string | null;
};

export default function ProfileBadge() {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile", { cache: "no-store" })
      .then((r) =>
        r.status === 401 ? { authenticated: false } : r.json(),
      )
      .then((p: Profile) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        if (!cancelled) setProfile({ authenticated: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!profile?.authenticated || !profile.name) return null;

  const inner = (
    <div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 text-sm transition-colors hover:bg-white/[0.08]">
      {profile.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.image}
          alt=""
          className="h-7 w-7 flex-shrink-0 rounded-full"
        />
      ) : (
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-xs font-bold text-black">
          {profile.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="font-semibold text-white">{profile.name}</span>
    </div>
  );

  if (profile.profileUrl) {
    return (
      <a href={profile.profileUrl} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  }
  return inner;
}
