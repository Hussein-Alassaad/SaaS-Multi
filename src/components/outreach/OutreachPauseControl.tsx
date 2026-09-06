"use client";

import { useState, useTransition } from "react";
import { Play, Pause } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { setOutreachPauseStateAction } from "@/lib/actions/outreach-pause";

/**
 * Tenant-facing, self-service "pause my outreach" switch -- see
 * setOutreachPauseStateAction's own docstring for how this differs from
 * OutreachAccount.status. Deliberately requires a confirm on BOTH
 * directions (not just pausing): resuming after a pause immediately
 * re-enables real, unattended LinkedIn/Instagram/email activity, which is
 * exactly the kind of action this codebase's own conventions (e.g.
 * AccountHealthClient's account-removal confirm) gate behind a deliberate
 * click, not a silent toggle.
 */
export function OutreachPauseControl({ initialPaused }: { initialPaused: boolean }) {
  const [paused, setPaused] = useState(initialPaused);
  const [pending, startTransition] = useTransition();
  const { showToast } = useToast();

  const toggle = () => {
    const next = !paused;
    const confirmed = window.confirm(
      next
        ? "Pause all outreach for this account? Discovery, message generation, and sending will stop across every channel until you resume."
        : "Resume outreach? The agent will start discovering leads and sending messages again on its normal schedule."
    );
    if (!confirmed) return;

    startTransition(async () => {
      const result = await setOutreachPauseStateAction(next);
      if (!result.ok) {
        showToast({ title: "Couldn't update", description: result.error, variant: "error" });
        return;
      }
      setPaused(next);
      showToast({
        title: next ? "Outreach paused" : "Outreach resumed",
        description: next ? "Nothing will send until you resume." : "The agent is back on its normal schedule.",
        variant: "success",
      });
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        paused
          ? "bg-[#4fd293]/15 text-[#3fb87e] ring-1 ring-[#4fd293]/30 hover:bg-[#4fd293]/25"
          : "bg-[var(--status-hot)]/10 text-[var(--status-hot)] ring-1 ring-[var(--status-hot)]/20 hover:bg-[var(--status-hot)]/20"
      }`}
      title={paused ? "Resume outreach" : "Pause outreach"}
    >
      {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      {pending ? "Working…" : paused ? "Run agent" : "Pause agent"}
    </button>
  );
}
