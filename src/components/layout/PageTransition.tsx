"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

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
 * Next.js already keeps the OLD page mounted and visible for exactly this
 * reason (App Router navigations are React transitions -- interruptible,
 * non-blocking, old UI stays interactive while new content streams in).
 * The bug was fighting that behavior instead of using it. This version
 * never unmounts ANYTHING on navigation -- not even this wrapper div (an
 * earlier attempt keyed the div itself to force a remount, which is its
 * own bug: it destroys and rebuilds the whole subtree on every nav, which
 * can itself race the new page's data). `children` swap in place via
 * React's own reconciliation on this one persistent node, and the fade is
 * replayed by toggling a class directly via a ref, which never touches
 * mount state.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPathname = useRef(pathname);
  const containerRef = useRef<HTMLDivElement>(null);

  // Retriggers the CSS animation on the SAME DOM node (no remount, no key
  // change) by removing and re-adding the class -- a class added once and
  // left alone never replays on subsequent renders, since the class value
  // itself doesn't change. Restarting via a fresh class name each time
  // guarantees the animation always replays without ever unmounting
  // anything, so it can never race the new page's data being ready.
  useEffect(() => {
    if (prevPathname.current === pathname) return;
    prevPathname.current = pathname;
    const el = containerRef.current;
    if (!el) return;
    el.classList.remove("animate-page-fade-in");
    // Force a reflow so the browser registers the class removal before it's
    // re-added -- otherwise the two class mutations coalesce into one and
    // the animation never restarts.
    void el.offsetWidth;
    el.classList.add("animate-page-fade-in");
  }, [pathname]);

  return (
    <div ref={containerRef} className="animate-page-fade-in">
      {children}
    </div>
  );
}
