"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useOutreachRealtime } from "@/lib/outreach/realtime";

export interface RunRow {
  id: string;
  accountId: string | null;
  accountLabel: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  notes: string | null;
}

const STATUS_RING: Record<string, string> = {
  running: "ring-[var(--status-cold)]/30 bg-[var(--status-cold)]/10 text-[var(--status-cold)]",
  error: "ring-[var(--status-hot)]/30 bg-[var(--status-hot)]/10 text-[var(--status-hot)]",
  completed: "ring-[#4fd293]/30 bg-[#4fd293]/10 text-[#3fb87e]",
};

function duration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return null;
  const seconds = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  return `${seconds}s`;
}

function tick(startedAt: string) {
  return `${Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000))}s`;
}

const DOT_DELAYS = [0, 0.15, 0.3];

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5">
      {DOT_DELAYS.map((delay) => (
        <motion.span
          key={delay}
          className="h-1 w-1 rounded-full bg-[var(--status-cold)]"
          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, delay, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

export function RunStatusClient({ tenantId, initialRuns }: { tenantId: string; initialRuns: RunRow[] }) {
  const runs = initialRuns;
  const [, setNow] = useState(() => Date.now());
  const router = useRouter();

  const hasRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "outreach_runs", tenantId, reload });

  return (
    <div className="mx-auto max-w-2xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          Run <span className="text-gradient">Status</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">Last 20 runs across all accounts.</p>
      </motion.header>

      <div className="mt-6 space-y-2">
        <AnimatePresence mode="popLayout">
          {runs.map((run) => (
            <motion.div
              key={run.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="glass glass-hover flex items-center justify-between gap-3 rounded-xl p-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--text-1)]">{run.accountLabel}</p>
                <p className="mt-0.5 text-xs text-[var(--text-4)]">
                  Started {new Date(run.startedAt).toLocaleString()}
                  {run.finishedAt && ` · finished ${new Date(run.finishedAt).toLocaleTimeString()}`}
                  {duration(run.startedAt, run.finishedAt) && ` · ${duration(run.startedAt, run.finishedAt)}`}
                  {run.status === "running" && ` · ${tick(run.startedAt)} elapsed`}
                </p>
                {run.notes && <p className="mt-1 text-xs text-[var(--status-hot)]">{run.notes}</p>}
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1",
                  STATUS_RING[run.status] ?? "ring-[var(--border-hairline)] bg-[var(--surface-2)] text-[var(--text-4)]"
                )}
              >
                {run.status === "running" && <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-cold)] animate-pulse" />}
                {run.status}
                {run.status === "running" && <TypingDots />}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {runs.length === 0 && <p className="text-sm text-[var(--text-4)]">No runs recorded yet.</p>}
      </div>
    </div>
  );
}
