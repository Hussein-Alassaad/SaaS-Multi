"use client";

import { useState, useTransition, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useOutreachRealtime } from "@/lib/outreach/realtime";
import { markOutreachErrorResolvedAction } from "@/lib/actions/outreach-errors";
import { useToast } from "@/components/ui/Toast";

export interface OutreachErrorRow {
  id: string;
  stage: string;
  channel: string | null;
  isExpected: boolean;
  resolved: boolean;
  message: string;
  leadId: string | null;
  leadName: string | null;
  accountId: string | null;
  accountLabel: string | null;
  occurredAt: string;
}

const STAGE_LABEL: Record<string, string> = {
  discovery: "Discovery",
  analysis: "Analysis",
  message_generation: "Message generation",
  sending: "Sending",
  reply_check: "Reply check",
  followup: "Follow-up",
};

const FILTERS = [
  { key: "real", label: "Real problems" },
  { key: "expected", label: "Normal skips" },
  { key: "all", label: "All" },
] as const;

export function ErrorsClient({ tenantId, initialErrors }: { tenantId: string; initialErrors: OutreachErrorRow[] }) {
  const [errors, setErrors] = useState(initialErrors);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("real");
  const [, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "error_logs", tenantId, reload });

  const markResolved = (id: string) => {
    setErrors((prev) => prev.map((e) => (e.id === id ? { ...e, resolved: true } : e)));
    startTransition(async () => {
      const result = await markOutreachErrorResolvedAction(id);
      if (!result.ok) {
        showToast({ title: "Failed to update", description: result.error, variant: "error" });
        return;
      }
      showToast({ title: "Marked resolved", variant: "success" });
    });
  };

  const filtered = errors.filter((e) => {
    if (filter === "real") return !e.isExpected && !e.resolved;
    if (filter === "expected") return e.isExpected;
    return true;
  });

  const realUnresolvedCount = errors.filter((e) => !e.isExpected && !e.resolved).length;

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          <span className="text-gradient">Errors</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">Everything the agent failed to do, so nothing goes unnoticed.</p>
      </motion.header>

      <div className="mt-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              filter === f.key
                ? "border-[var(--accent-from)]/60 bg-[var(--accent-from)]/10 text-[var(--text-1)]"
                : "border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 text-[var(--text-4)] hover:text-[var(--text-2)]"
            )}
          >
            {f.label}
            {f.key === "real" && realUnresolvedCount > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--status-hot)]/20 px-1.5 text-[var(--status-hot)]">
                {realUnresolvedCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-6 text-sm text-[var(--text-4)]">
          {filter === "real" ? "No unresolved problems. Everything ran clean." : "Nothing here."}
        </p>
      )}

      <div className="mt-6 space-y-2">
        <AnimatePresence mode="popLayout">
          {filtered.map((err) => (
            <motion.div
              key={err.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className={cn("glass rounded-xl p-3.5", err.isExpected && "opacity-70")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-[var(--border-hairline-strong)] bg-[var(--surface-2)]/60 px-2 py-0.5 text-[11px] text-[var(--text-3)]">
                      {STAGE_LABEL[err.stage] || err.stage}
                    </span>
                    {err.channel && (
                      <span className="rounded-full border border-[var(--border-hairline-strong)] bg-[var(--surface-2)]/60 px-2 py-0.5 text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                        {err.channel}
                      </span>
                    )}
                    {err.isExpected && (
                      <span className="rounded-full border border-[var(--status-cold)]/30 bg-[var(--status-cold)]/10 px-2 py-0.5 text-[11px] text-[var(--status-cold)]">
                        Normal skip
                      </span>
                    )}
                    {err.resolved && (
                      <span className="rounded-full border border-[#4fd293]/30 bg-[#4fd293]/10 px-2 py-0.5 text-[11px] text-[#3fb87e]">
                        Resolved
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-[var(--text-2)]">{err.message}</p>
                  <p className="mt-1 text-xs text-[var(--text-4)]">
                    {err.leadName ? `${err.leadName} · ` : ""}
                    {err.accountLabel ? `${err.accountLabel} · ` : ""}
                    {new Date(err.occurredAt).toLocaleString()}
                  </p>
                </div>
                {!err.isExpected && !err.resolved && (
                  <button
                    type="button"
                    onClick={() => markResolved(err.id)}
                    className="shrink-0 rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-2.5 py-1.5 text-xs font-medium text-[var(--text-3)] outline-none transition-colors hover:border-[#4fd293]/40 hover:text-[#3fb87e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
                  >
                    Mark resolved
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
