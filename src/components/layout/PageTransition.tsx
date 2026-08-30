"use client";

import { useEffect, useRef, useState } from "react";
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
 * never unmounts anything on navigation: `children` swaps via React's own
 * reconciliation (already deferred correctly by the framework), and a
 * CSS-only fade plays on top AFTER the swap has already happened, driven
 * by detecting that pathname changed since the last commit -- not by
 * keying/unmounting the tree.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPathname = useRef(pathname);
  const [fadeKey, setFadeKey] = useState(0);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      setFadeKey((k) => k + 1);
    }
  }, [pathname]);

  return (
    <div key={fadeKey} className="animate-page-fade-in">
      {children}
    </div>
  );
}
