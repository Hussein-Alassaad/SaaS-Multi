"use client";

import { useImpersonation } from "@/lib/store/impersonation";
import { endImpersonationAction } from "@/lib/actions/impersonation";
import { UserCog, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ImpersonationBanner() {
  const { impersonation, endImpersonation } = useImpersonation();

  const handleExit = async () => {
    if (impersonation?.sessionId) {
      await endImpersonationAction(impersonation.sessionId, impersonation.tenantId);
    }
    endImpersonation();
  };

  return (
    <div
      className={cn(
        "sticky top-0 z-40 grid overflow-hidden transition-all duration-200 ease-out",
        impersonation ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}
    >
      <div className="min-h-0">
        {impersonation && (
          <div className="flex items-center justify-center gap-3 bg-accent-gradient px-4 py-2 text-sm font-medium text-white">
            <UserCog className="h-4 w-4" />
            <span>
              Viewing as <strong>{impersonation.tenantName}</strong> — impersonation session active
            </span>
            <button
              onClick={handleExit}
              className="ml-3 inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-xs hover:bg-white/30"
            >
              <X className="h-3 w-3" />
              Exit impersonation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
