"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";

/**
 * Duration of the page transition, in ms. Exported so realtime consumers can
 * avoid firing a router.refresh() while a transition is still animating (see
 * useOutreachRealtime) -- keep this in sync with the transition below.
 */
export const PAGE_TRANSITION_MS = 200;

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    // mode="wait" (the original setting) blocked the incoming page from
    // mounting until the outgoing page's exit finished, which read as a
    // freeze when switching sections -- so this animates enter/exit
    // concurrently instead. But concurrent exit/enter means BOTH pages are
    // mounted at once, and in normal document flow the exiting page still
    // occupies its full height: the incoming page gets pushed below it, then
    // the exiting page unmounts and everything snaps back up in one frame.
    // Measured on a populated page: main height went 2088 -> 2112 -> 900,
    // a 1212px collapse ~210ms in. That single-frame jump is the "stutter",
    // and it scales with how much real data the page has (which is why it's
    // worse in production than on a near-empty dev page).
    //
    // position:grid with both children in the SAME cell keeps them stacked on
    // top of each other rather than end-to-end, so the exiting page never
    // contributes height of its own and the incoming page never moves.
    <div className="grid grid-cols-1 [&>*]:col-start-1 [&>*]:row-start-1">
      <AnimatePresence initial={false}>
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: PAGE_TRANSITION_MS / 1000, ease: "easeOut" }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
