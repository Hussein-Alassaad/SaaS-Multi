"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { endImpersonationAction } from "@/lib/actions/impersonation";
import { UserCog, X } from "lucide-react";

/**
 * Real as of 2026-09-09 -- `active` is fetched server-side by the caller
 * (getActiveImpersonation() in auth.ts, itself re-verified against a real
 * DB row and the impersonation cookie, not just client state) and passed
 * in as a prop. Previously this read a client-only React context
 * (lib/store/impersonation.tsx) that nothing else in the app ever wrote
 * to from the server, so the banner could show "viewing as X" while every
 * page was still serving the admin's own data -- see
 * startImpersonationAction's docstring for the full bug.
 */
export function ImpersonationBanner({
  active,
}: {
  active: { tenantId: string; tenantName: string; sessionId: string } | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (!active) return null;

  const handleExit = () => {
    startTransition(async () => {
      await endImpersonationAction(active.sessionId, active.tenantId);
      router.push("/admin/tenants");
      router.refresh();
    });
  };

  return (
    <div className="sticky top-0 z-40 flex items-center justify-center gap-3 bg-accent-gradient px-4 py-2 text-sm font-medium text-white">
      <UserCog className="h-4 w-4" />
      <span>
        Viewing as <strong>{active.tenantName}</strong> — impersonation session active
      </span>
      <button
        onClick={handleExit}
        disabled={pending}
        className="ml-3 inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-xs hover:bg-white/30 disabled:opacity-60"
      >
        <X className="h-3 w-3" />
        {pending ? "Exiting…" : "Exit impersonation"}
      </button>
    </div>
  );
}
