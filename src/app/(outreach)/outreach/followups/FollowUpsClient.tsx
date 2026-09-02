"use client";

import { useState, useTransition, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useOutreachRealtime } from "@/lib/outreach/realtime";
import { followUpAllAction, type FollowUpLead } from "@/lib/actions/outreach-followups";
import { setDoNotContactAction } from "@/lib/actions/outreach-lead-detail";

const TEMPERATURE_VARIANT: Record<string, "hot" | "warm" | "cold"> = { hot: "hot", warm: "warm", cold: "cold" };

function EmptyState() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-16 flex flex-col items-center px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-gradient/15 ring-1 ring-[var(--accent-from)]/20">
        <Users className="h-6 w-6 text-[var(--accent-from)]" strokeWidth={1.5} />
      </div>
      <p className="mt-4 text-sm font-medium text-[var(--text-2)]">Nobody's waiting on a follow-up</p>
      <p className="mt-1 max-w-xs text-xs text-[var(--text-5)]">
        Every messaged lead has either replied or hasn't been contacted yet.
      </p>
    </motion.div>
  );
}

export function FollowUpsClient({
  tenantId,
  initialLeads,
}: {
  tenantId: string;
  initialLeads: FollowUpLead[];
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [isPending, startTransition] = useTransition();
  const [justScheduled, setJustScheduled] = useState<number | null>(null);
  const { showToast } = useToast();
  const router = useRouter();

  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "outreach_leads", tenantId, reload, debounceMs: 500 });
  const [excludingId, setExcludingId] = useState<string | null>(null);

  // Real instruction from the platform owner (2026-09-02): a per-lead way
  // to exclude one lead from this section specifically. There's no
  // narrower "skip follow-up only" flag in the schema -- this reuses the
  // existing doNotContact toggle (already permanently excluded from this
  // list's own query, see getNotRepliedLeadsAction), which the owner
  // explicitly confirmed is the right mechanism rather than building a
  // separate flag. It IS a permanent, all-channel opt-out, not
  // follow-up-only -- the confirm dialog says so plainly so this isn't a
  // surprise later.
  const excludeLead = (lead: FollowUpLead) => {
    const confirmed = window.confirm(
      `Mark ${lead.businessName || "this lead"} as Do Not Contact?\n\nThis is permanent and stops ALL future outreach to them, not just follow-ups -- the same toggle as on their own lead page.`
    );
    if (!confirmed) return;

    setExcludingId(lead.id);
    startTransition(async () => {
      const result = await setDoNotContactAction(lead.id, true, "Excluded from bulk follow-up");
      setExcludingId(null);
      if (!result.ok) {
        showToast({ title: "Couldn't exclude", description: result.error, variant: "error" });
        return;
      }
      setLeads((prev) => prev.filter((l) => l.id !== lead.id));
      showToast({ title: "Excluded", description: `${lead.businessName || "This lead"} won't be contacted again.`, variant: "success" });
    });
  };

  const followUpAll = () => {
    startTransition(async () => {
      const result = await followUpAllAction();
      if (!result.ok) {
        showToast({ title: "Couldn't schedule follow-ups", description: result.error, variant: "error" });
        return;
      }
      setJustScheduled(result.scheduled);
      showToast({
        title: "Follow-ups scheduled",
        description:
          result.scheduled === 0
            ? "Nothing to follow up right now."
            : `${result.scheduled} lead${result.scheduled === 1 ? "" : "s"} scheduled — messages will appear in the Approval Queue shortly.`,
        variant: "success",
      });
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          Follow <span className="text-gradient">Up</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">
          Every lead that's been messaged but hasn't replied yet. Follow-up messages go through the normal
          Approval Queue before anything sends.
        </p>
      </motion.header>

      {leads.length > 0 && (
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={followUpAll}
          disabled={isPending}
          className="mt-4 rounded-xl bg-accent-gradient px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-[var(--accent-from)]/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Scheduling…" : `Follow Up All (${leads.length})`}
        </motion.button>
      )}

      {justScheduled !== null && justScheduled > 0 && (
        <p className="mt-2 text-xs text-[var(--text-5)]">
          Scheduled — check the Approval Queue in a moment once the agent generates each message.
        </p>
      )}

      {leads.length === 0 && <EmptyState />}

      <div className="mt-6 space-y-3">
        <AnimatePresence mode="popLayout">
          {leads.map((lead) => (
            <motion.div
              key={lead.id}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97 }}
              className="glass rounded-2xl p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/outreach/leads/${lead.id}`}
                  className="text-sm font-semibold text-[var(--text-1)] underline-offset-2 hover:text-[var(--accent-from)] hover:underline"
                >
                  {lead.businessName || "Unknown business"}
                </Link>
                <div className="flex shrink-0 items-center gap-1.5">
                  {lead.temperature && TEMPERATURE_VARIANT[lead.temperature] && (
                    <Badge variant={TEMPERATURE_VARIANT[lead.temperature]}>{lead.temperature}</Badge>
                  )}
                  <span className="rounded-full border border-[var(--border-hairline-strong)] px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--text-4)]">
                    {lead.platform}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-[var(--text-5)]">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {lead.firstContactedAt
                    ? `First contacted ${new Date(lead.firstContactedAt).toLocaleDateString()}`
                    : "Contact date unknown"}
                </span>
                <span>
                  {lead.contactCount} contact{lead.contactCount === 1 ? "" : "s"} so far
                </span>
              </div>
              <button
                onClick={() => excludeLead(lead)}
                disabled={excludingId === lead.id}
                className="mt-3 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {excludingId === lead.id ? "Excluding…" : "Exclude"}
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
