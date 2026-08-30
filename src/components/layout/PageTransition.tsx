"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useIsNavPending } from "@/lib/navigation-pending";
import { PageLoadingSkeleton } from "./PageLoadingSkeleton";

/**
 * Previously used Framer Motion's AnimatePresence keyed on pathname, which
 * unmounts the OLD page's motion.div the instant pathname changes -- but
 * pathname updates as part of the same React transition Next.js uses for
 * the navigation itself, which fires immediately on click, well before the
 * destination page's server-fetched data has arrived. That created a real
 * blank gap (confirmed via a live production trace: ~700ms-1s of empty
 * <main>) between the old page disappearing and the new page's content
 * being ready -- which read as a stutter/freeze, not a smooth fade.
 *
 * Next.js already keeps the OLD page mounted and visible while new content
 * streams in, and loading.tsx is SUPPOSED to fill the gap with a fallback.
 * But under real slow/throttled conditions (confirmed via a live trace,
 * repeated network+CPU-throttled runs against production), the loading.tsx
 * fallback can ITSELF arrive late -- Next's own docs confirm this: "the
 * loading.js fallback may not appear immediately because it hasn't been
 * prefetched yet" on a slow network. That's a framework-level Suspense/
 * streaming timing gap this component can't close from below.
 *
 * Fix: each nav <Link> reports its pending state up via NavPendingProvider
 * (see navigation-pending.tsx) using useLinkStatus -- a pure client-side
 * signal set the instant a link is clicked, independent of network
 * conditions. That marks the START of a navigation reliably.
 *
 * For the END: useLinkStatus's `pending` goes false exactly when the URL
 * updates, NOT when the new page's content has actually committed -- so it
 * can't mark the end by itself (that gap between "URL changed" and
 * "content committed" is the original bug). Instead: a navigation starts
 * (isNavPending becomes true) -> latch the overlay on. It only ever comes
 * back off once pathname has changed to a NEW value while NOT pending --
 * i.e. after this component has re-rendered past the click AND the click
 * is no longer in flight, which only happens once the destination's
 * content has actually taken pathname's new value through a real commit.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);
  const isNavPending = useIsNavPending();

  const [overlayOn, setOverlayOn] = useState(false);
  const latchedPathnameRef = useRef(pathname);

  if (isNavPending && !overlayOn) {
    setOverlayOn(true);
  }

  useEffect(() => {
    if (overlayOn && !isNavPending && latchedPathnameRef.current !== pathname) {
      latchedPathnameRef.current = pathname;
      setOverlayOn(false);
      const el = containerRef.current;
      if (el) {
        el.classList.remove("animate-page-fade-in");
        void el.offsetWidth;
        el.classList.add("animate-page-fade-in");
      }
    }
  }, [pathname, isNavPending, overlayOn]);

  return (
    <div className="relative">
      {overlayOn && (
        <div className="absolute inset-0 z-20 bg-[var(--surface-1)]">
          <PageLoadingSkeleton />
        </div>
      )}
      <div ref={containerRef} className="animate-page-fade-in">
        {children}
      </div>
    </div>
  );
}
