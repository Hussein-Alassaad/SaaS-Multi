"use client";

import { AnimatePresence, motion } from "framer-motion";

/**
 * Every sidebar label/text next to an icon used to be a raw
 * `{expanded && <span>...}` -- it popped in and out instantly with no
 * animation, completely out of sync with the smooth width transition
 * happening on the sidebar around it at the same time. That mismatch (six
 * separate pieces of text snapping while the container glides) is most of
 * what read as "not smooth" about the hover expand/collapse, more than the
 * width transition itself. This fades + slides each label in step with the
 * width change instead of an abrupt mount/unmount.
 */
export function SidebarExpandedLabel({
  expanded,
  children,
  className,
  as = "span",
}: {
  expanded: boolean;
  children: React.ReactNode;
  className?: string;
  /** "div" for multi-line/stacked content (e.g. name + role) -- span defaults to inline, which breaks block stacking. */
  as?: "span" | "div";
}) {
  const MotionTag = as === "div" ? motion.div : motion.span;
  return (
    <AnimatePresence>
      {expanded && (
        <MotionTag
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -4 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className={className}
        >
          {children}
        </MotionTag>
      )}
    </AnimatePresence>
  );
}
