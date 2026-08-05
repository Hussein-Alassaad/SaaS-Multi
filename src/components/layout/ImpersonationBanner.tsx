"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useUiStore } from "@/lib/store/ui";
import { UserCog, X } from "lucide-react";

export function ImpersonationBanner() {
  const impersonation = useUiStore((s) => s.impersonation);
  const endImpersonation = useUiStore((s) => s.endImpersonation);

  return (
    <AnimatePresence>
      {impersonation && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="sticky top-0 z-40 overflow-hidden"
        >
          <div className="flex items-center justify-center gap-3 bg-accent-gradient px-4 py-2 text-sm font-medium text-white">
            <UserCog className="h-4 w-4" />
            <span>
              Viewing as <strong>{impersonation.tenantName}</strong> — impersonation session active
            </span>
            <button
              onClick={endImpersonation}
              className="ml-3 inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-xs hover:bg-white/30"
            >
              <X className="h-3 w-3" />
              Exit impersonation
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
