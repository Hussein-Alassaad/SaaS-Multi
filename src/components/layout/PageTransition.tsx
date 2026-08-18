"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    // mode="wait" (the previous setting) blocks the incoming page from
    // mounting until the outgoing page's exit animation fully finishes --
    // under load (larger pages, data fetching) this reads as a freeze when
    // switching sections. Default mode animates enter/exit concurrently.
    <AnimatePresence>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
