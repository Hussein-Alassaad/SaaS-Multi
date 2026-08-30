"use client";

import { useState, useTransition, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Inbox } from "lucide-react";
import { LeadCard, type LeadCardData } from "@/components/outreach/LeadCard";
import { loadMoreLiveFeedAction } from "@/lib/actions/outreach-leads";
import { useOutreachRealtime } from "@/lib/outreach/realtime";
import { useRouter } from "next/navigation";

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="mt-12 flex flex-col items-center px-4 text-center"
    >
      {/* Was a perpetual float (repeat: Infinity). The Live Feed empty state
          is what every tenant sees until an account is connected, so that
          animation never stopped -- it kept a compositor animation running on
          this page permanently, competing for frames with the page-transition
          animation on the way in and out. A single settle-in keeps the same
          visual character without leaving motion running forever. */}
      <motion.div
        initial={{ y: -6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-gradient/15 ring-1 ring-[var(--accent-from)]/20"
      >
        <Inbox className="h-7 w-7 text-[var(--accent-from)]" strokeWidth={1.5} />
      </motion.div>
      <p className="mt-4 text-sm font-medium text-[var(--text-2)]">No leads yet today</p>
      <p className="mt-1 max-w-xs text-xs text-[var(--text-5)]">
        They&apos;ll appear here the moment the agent finds one.
      </p>
    </motion.div>
  );
}

export function LiveFeedClient({
  tenantId,
  initialLeads,
  initialNextCursor,
}: {
  tenantId: string;
  initialLeads: LeadCardData[];
  initialNextCursor: string | null;
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, startLoadMoreTransition] = useTransition();
  const router = useRouter();

  const handleLoadMore = () => {
    if (!nextCursor) return;
    startLoadMoreTransition(async () => {
      const result = await loadMoreLiveFeedAction(nextCursor);
      if (result.ok) {
        setLeads((prev) => [...prev, ...result.leads]);
        setNextCursor(result.nextCursor);
      }
    });
  };

  const reload = useCallback(() => router.refresh(), [router]);

  useOutreachRealtime({ table: "outreach_leads", tenantId, reload });

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          Live <span className="text-gradient">Feed</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">Today&apos;s leads, hottest first.</p>
      </motion.header>

      {leads.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-6 space-y-3">
          <AnimatePresence mode="popLayout">
            {leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {nextCursor && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-4 py-2 text-xs font-medium text-[var(--text-3)] outline-none transition-colors hover:border-[var(--accent-from)]/50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
