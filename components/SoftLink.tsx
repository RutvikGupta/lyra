"use client";

// Drop-in for next/link that wraps the navigation in
// document.startViewTransition so the browser auto-crossfades the old and
// new page snapshots. Handy when leaving a heavy WebGL view (/library,
// /explore) for a static page — the hard cut from constellation → hero
// felt jarring otherwise.
//
// Browsers without View Transitions (Firefox <128, older Safari) just
// fall through to a normal Link click, which is the existing behavior —
// no regression.

import Link, { type LinkProps } from "next/link";
import { useRouter } from "next/navigation";
import { type AnchorHTMLAttributes, type ReactNode } from "react";

type Props = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children: ReactNode;
  };

type DocumentWithVT = Document & {
  startViewTransition?: (cb: () => void) => unknown;
};

export default function SoftLink({ children, onClick, href, ...rest }: Props) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        // Modifier-clicks: let the browser open in a new tab/window.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (e.button !== 0) return; // not a left click
        const doc = document as DocumentWithVT;
        if (typeof doc.startViewTransition !== "function") return;
        e.preventDefault();
        doc.startViewTransition(() => {
          router.push(href.toString());
        });
      }}
      {...rest}
    >
      {children}
    </Link>
  );
}
