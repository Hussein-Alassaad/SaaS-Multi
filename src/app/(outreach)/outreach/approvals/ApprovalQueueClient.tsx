"use client";

import { useState, useTransition, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { useOutreachRealtime } from "@/lib/outreach/realtime";
import {
  approveMessageAction,
  holdMessageAction,
  saveMessageEditAction,
  approveAllMessagesAction,
  retryFailedEmailSendAction,
  deleteMessageAction,
  deapproveMessageAction,
  setApprovalRequiredAction,
} from "@/lib/actions/outreach-approvals";

export interface ApprovalMessage {
  id: string;
  leadId: string;
  channel: string;
  body: string;
  editedBody: string | null;
  approvalStatus: string;
  sendStatus: string;
  sendFailureReason: string | null;
  sendFailurePermanent: boolean;
  holdReason: string | null;
  isFollowup: boolean;
  lead: {
    id: string;
    businessName: string | null;
    platform: string;
    score: number | null;
    temperature: string | null;
    discoveredAt: string;
  };
}

const SWIPE_THRESHOLD = 110;

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1 }}
      className="mt-12 flex flex-col items-center px-4 text-center"
    >
      <motion.div
        animate={{ y: [0, -8, 0] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-gradient/15 ring-1 ring-[var(--accent-from)]/20"
      >
        <CheckCircle2 className="h-7 w-7 text-[var(--accent-from)]" strokeWidth={1.5} />
      </motion.div>
      <p className="mt-4 text-sm font-medium text-[var(--text-2)]">All caught up</p>
      <p className="mt-1 max-w-xs text-xs text-[var(--text-5)]">Nothing is waiting on your approval right now.</p>
    </motion.div>
  );
}

function DraggableCard({
  onApprove,
  onHold,
  children,
}: {
  onApprove: () => void;
  onHold: () => void;
  children: React.ReactNode;
}) {
  const x = useMotionValue(0);
  const background = useTransform(
    x,
    [-SWIPE_THRESHOLD * 1.5, 0, SWIPE_THRESHOLD * 1.5],
    ["rgba(248, 113, 113, 0.16)", "rgba(0, 0, 0, 0)", "rgba(52, 211, 153, 0.16)"]
  );
  const approveOpacity = useTransform(x, [10, SWIPE_THRESHOLD], [0, 1]);
  const holdOpacity = useTransform(x, [-SWIPE_THRESHOLD, -10], [1, 0]);

  function handleDragEnd(_: unknown, info: PanInfo) {
    if (info.offset.x > SWIPE_THRESHOLD) onApprove();
    else if (info.offset.x < -SWIPE_THRESHOLD) onHold();
  }

  return (
    <motion.div layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="relative">
      <motion.div
        style={{ opacity: approveOpacity }}
        className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-sm font-semibold text-[#4fd293] md:hidden"
      >
        Approve →
      </motion.div>
      <motion.div
        style={{ opacity: holdOpacity }}
        className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-5 text-sm font-semibold text-[var(--status-hot)] md:hidden"
      >
        ← Hold
      </motion.div>
      <motion.div
        style={{ x, background }}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.6}
        onDragEnd={handleDragEnd}
        whileDrag={{ cursor: "grabbing" }}
        className="glass glass-hover touch-pan-y rounded-2xl p-4"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export interface DailyTargets {
  instagram: number;
  email: number;
}

// OWNER REQUEST 2026-10-04: group the queue by the LEAD's discovery date
// (not the message's own createdAt -- a message can be generated well after
// discovery, e.g. once Icypeas finds an email) so each night's cycle shows
// as its own section, with "X of TARGET found" / "Y approved" per channel.
// Local calendar day (not UTC) since this is the owner's own day-boundary
// intuition ("the day they are discovered"), not a server-time technicality.
function discoveryDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateHeading(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function groupByDiscoveryDate(messages: ApprovalMessage[]) {
  const groups = new Map<string, ApprovalMessage[]>();
  for (const m of messages) {
    const key = discoveryDateKey(m.lead.discoveredAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  // Newest date first -- tonight's cycle belongs at the top, not buried
  // under everything still awaiting approval from earlier nights.
  return Array.from(groups.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
}

export interface DailyCounts {
  igFound: number;
  igApproved: number;
  emailFound: number;
  emailApproved: number;
}

function DateSectionHeader({ dateKey, dailyTargets, counts }: { dateKey: string; dailyTargets: DailyTargets; counts: DailyCounts | undefined }) {
  // Falls back to all-zero if a date somehow has pending cards but no
  // server-computed count (shouldn't happen -- dailyCounts is built from
  // every message the pending list is itself a subset of -- but a missing
  // key must render "0 of N", not crash the page).
  const { igFound, igApproved, emailFound, emailApproved } = counts ?? { igFound: 0, igApproved: 0, emailFound: 0, emailApproved: 0 };

  return (
    <div className="sticky top-0 z-10 -mx-4 mb-3 bg-[var(--surface-0)]/90 px-4 py-2 backdrop-blur-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--border-hairline-strong)] pb-2">
        <h2 className="text-sm font-semibold text-[var(--text-1)]">{formatDateHeading(dateKey)}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--text-4)]">
          {(igFound > 0 || dailyTargets.instagram > 0) && (
            <span>
              Instagram: <span className="font-medium text-[var(--text-2)]">{igFound}</span> of {dailyTargets.instagram} found
              {igApproved > 0 && <span className="text-[var(--text-5)]"> · {igApproved} approved</span>}
            </span>
          )}
          {(emailFound > 0 || dailyTargets.email > 0) && (
            <span>
              Email: <span className="font-medium text-[var(--text-2)]">{emailFound}</span> of {dailyTargets.email} found
              {emailApproved > 0 && <span className="text-[var(--text-5)]"> · {emailApproved} approved</span>}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ApprovalQueueClient({
  tenantId,
  initialMessages,
  dailyTargets,
  dailyCounts,
  initialApprovalRequired,
}: {
  tenantId: string;
  initialMessages: ApprovalMessage[];
  dailyTargets: DailyTargets;
  dailyCounts: Record<string, DailyCounts>;
  initialApprovalRequired: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [holdReasons, setHoldReasons] = useState<Record<string, string>>({});
  const [approvalRequired, setApprovalRequired] = useState(initialApprovalRequired);
  const [, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  // OWNER REQUEST 2026-10-06: ON (approvalRequired=true, the default) keeps
  // today's behavior -- every generated message waits here first. OFF means
  // the Python/Next.js generation paths auto-approve a message the instant
  // it's created (see run_message_generation_cycle_for_tenant's own
  // approval_required check), skipping this queue's manual Approve step
  // entirely -- it would only ever show up already in the Approved section
  // below, never in Awaiting approval.
  const toggleApprovalRequired = () => {
    const next = !approvalRequired;
    setApprovalRequired(next);
    startTransition(async () => {
      const result = await setApprovalRequiredAction(next);
      if (!result.ok) {
        setApprovalRequired(!next);
        showToast({ title: "Couldn't change this", description: result.error, variant: "error" });
        return;
      }
      showToast({
        title: next ? "Manual approval back on" : "Auto-approve turned on",
        description: next
          ? "New messages will wait here for your review again."
          : "New messages will be approved automatically from now on -- Instagram still only sends after a real send attempt, same as always.",
        variant: "default",
      });
    });
  };

  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "outreach_messages", tenantId, reload });

  const approve = (message: ApprovalMessage) => {
    // OWNER REQUEST 2026-10-06: approved messages now stay visible on this
    // page (the new "Approved" section below), so this no longer
    // optimistically removes the row -- it flips approvalStatus locally
    // (the card re-renders into the Approved section immediately) and
    // reload()s afterward either way to pick up the real server state
    // (approvedAt, any guard the server applied) rather than only on error.
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, approvalStatus: "approved" } : m)));
    startTransition(async () => {
      const result = await approveMessageAction(message.id);
      if (!result.ok) {
        showToast({ title: "Approve failed", description: result.error, variant: "error" });
        reload();
        return;
      }
      showToast({
        title: "Approved",
        description: `${message.lead.businessName || "This lead"} (${message.channel}) is cleared to send.`,
        variant: "success",
      });
      reload();
    });
  };

  const deapprove = (message: ApprovalMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, approvalStatus: "awaiting" } : m)));
    startTransition(async () => {
      const result = await deapproveMessageAction(message.id);
      if (!result.ok) {
        showToast({ title: "Couldn't pull this back", description: result.error, variant: "error" });
        reload();
        return;
      }
      showToast({
        title: "Back in the queue",
        description: `${message.lead.businessName || "This lead"} needs approval again before it can send.`,
        variant: "default",
      });
      reload();
    });
  };

  const hold = (message: ApprovalMessage) => {
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    startTransition(async () => {
      const result = await holdMessageAction(message.id, holdReasons[message.id]);
      if (!result.ok) {
        showToast({ title: "Hold failed", description: result.error, variant: "error" });
        return;
      }
      showToast({
        title: "Held",
        description: `${message.lead.businessName || "This lead"} (${message.channel}) held back from sending.`,
        variant: "default",
      });
    });
  };

  const saveEdit = (message: ApprovalMessage) => {
    const newBody = drafts[message.id];
    if (newBody == null) return;
    startTransition(async () => {
      const result = await saveMessageEditAction(message.id, newBody);
      if (!result.ok) {
        showToast({ title: "Save failed", description: result.error, variant: "error" });
        return;
      }
      showToast({ title: "Edit saved", description: "Remember to Approve once you're happy with it.", variant: "default" });
    });
  };

  // A failed-but-already-approved row (see getApprovalQueueAction's own
  // comment on why these now show here) is never a real pending decision
  // -- it must not be counted, swiped, or bulk-"Approve All"'d as if it
  // were still awaiting one; only its own Retry button applies to it.
  const isFailedRetry = (m: ApprovalMessage) => m.approvalStatus === "approved" && m.sendStatus === "failed";

  // Fixed 2026-09-16: "held" messages now reach the client at all (see
  // getApprovalQueueAction), but a hold is a deliberate, already-made
  // decision -- it renders as its own non-swipeable card (like the
  // failed-retry case above) instead of the normal Approve/Hold flow, and
  // stays out of pendingCount/Approve All, same as it already did before
  // this fix (approveAll/pendingCount already filtered approvalStatus !==
  // "held", just for a list that never actually contained any).
  const isHeld = (m: ApprovalMessage) => m.approvalStatus === "held";

  // OWNER REQUEST 2026-10-06: the new "Approved" section -- anything
  // cleared to send that ISN'T the failed-retry case above (that one keeps
  // its own distinct red "Failed to send" card, same as before). Covers
  // pending/queued_for_pacing/sending/sent so the section reflects
  // everything currently approved, not just the not-yet-attempted subset.
  const isApprovedSection = (m: ApprovalMessage) => m.approvalStatus === "approved" && !isFailedRetry(m);

  // Only a message still genuinely untouched (pending) can be pulled back --
  // matches deapproveMessageAction's own server-side guard exactly, kept
  // here too so the button itself doesn't appear where it would just error.
  const canDeapprove = (m: ApprovalMessage) => m.approvalStatus === "approved" && m.sendStatus === "pending";

  const deleteHeld = (message: ApprovalMessage) => {
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    startTransition(async () => {
      const result = await deleteMessageAction(message.id);
      if (!result.ok) {
        showToast({ title: "Delete failed", description: result.error, variant: "error" });
        return;
      }
      showToast({
        title: "Deleted",
        description: `${message.lead.businessName || "This lead"}'s held message was removed.`,
        variant: "default",
      });
    });
  };

  const retry = (message: ApprovalMessage) => {
    startTransition(async () => {
      const result = await retryFailedEmailSendAction(message.id);
      if (!result.ok) {
        showToast({ title: "Retry failed", description: result.error, variant: "error" });
        return;
      }
      showToast({ title: "Retrying", description: "Check back in a moment for the result.", variant: "default" });
      reload();
    });
  };

  const approveAll = () => {
    const toApprove = messages.filter((m) => m.approvalStatus === "awaiting");
    if (toApprove.length === 0) return;
    const toApproveIds = new Set(toApprove.map((m) => m.id));
    setMessages((prev) => prev.map((m) => (toApproveIds.has(m.id) ? { ...m, approvalStatus: "approved" } : m)));
    startTransition(async () => {
      const result = await approveAllMessagesAction(toApprove.map((m) => m.id));
      if (!result.ok) {
        showToast({ title: "Approve all failed", description: result.error, variant: "error" });
        return;
      }
      const skipped = "skippedUnreachable" in result ? result.skippedUnreachable : 0;
      showToast({
        title: "Approved",
        description:
          skipped > 0
            ? `${result.approvedCount} message${result.approvedCount === 1 ? "" : "s"} cleared to send. ${skipped} skipped -- can't be reached on that channel.`
            : `${toApprove.length} message${toApprove.length === 1 ? "" : "s"} cleared to send.`,
        variant: "success",
      });
      reload();
    });
  };

  const pendingCount = messages.filter((m) => m.approvalStatus === "awaiting").length;
  const approvedCount = messages.filter(isApprovedSection).length;

  // OWNER REQUEST 2026-10-06: two real sections instead of one flat list --
  // "awaiting" is the default tab (what actually needs a decision from the
  // owner right now, approvalStatus="awaiting" only); "approved" covers
  // everything already past that decision -- cleared to send (manually or
  // via the auto-approve toggle above, with its own De-approve action),
  // held back on purpose, or approved-but-failed (its own Retry card) --
  // every one of those is a message that's already been decided on, just
  // in different end states, so they all live in the same tab rather than
  // held/failed-retry splitting off into a third place.
  const [activeTab, setActiveTab] = useState<"awaiting" | "approved">("awaiting");
  const tabMessages = messages.filter((m) =>
    activeTab === "approved" ? isApprovedSection(m) || isHeld(m) || isFailedRetry(m) : m.approvalStatus === "awaiting"
  );

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
            Approval <span className="text-gradient">Queue</span>
          </h1>
          <p className="mt-1 text-sm text-[var(--text-4)]">
            {approvalRequired ? "Nothing sends until you approve it here." : "Auto-approve is on -- new messages skip straight to Approved."}
          </p>
        </div>
        <AnimatePresence>
          {pendingCount > 0 && (
            <motion.span
              key={pendingCount}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              className="shrink-0 rounded-full bg-[var(--status-hot)]/15 px-3 py-1 text-sm font-bold text-[var(--status-hot)] ring-1 ring-[var(--status-hot)]/30"
            >
              {pendingCount}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.header>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-3 py-2">
        <span className="text-xs font-medium text-[var(--text-3)]">
          {approvalRequired ? "Manual approval required" : "Auto-approve is on"}
        </span>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={toggleApprovalRequired}
          role="switch"
          aria-checked={!approvalRequired}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
            approvalRequired ? "bg-[var(--surface-3)]" : "bg-accent-gradient"
          }`}
        >
          <motion.span
            layout
            className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
            style={{ left: approvalRequired ? 2 : 22 }}
          />
        </motion.button>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setActiveTab("awaiting")}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
            activeTab === "awaiting" ? "bg-accent-gradient text-white" : "bg-[var(--surface-2)] text-[var(--text-3)]"
          }`}
        >
          Awaiting approval {pendingCount > 0 && `(${pendingCount})`}
        </button>
        <button
          onClick={() => setActiveTab("approved")}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
            activeTab === "approved" ? "bg-accent-gradient text-white" : "bg-[var(--surface-2)] text-[var(--text-3)]"
          }`}
        >
          Approved {approvedCount > 0 && `(${approvedCount})`}
        </button>
      </div>

      {activeTab === "awaiting" && pendingCount > 1 && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={approveAll}
          className="mt-4 rounded-xl bg-accent-gradient px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-[var(--accent-from)]/20"
        >
          Approve All ({pendingCount})
        </motion.button>
      )}

      {tabMessages.length === 0 && <EmptyState />}

      <div className="mt-6 space-y-8">
        {groupByDiscoveryDate(tabMessages).map(([dateKey, dayMessages]) => (
          <div key={dateKey}>
            <DateSectionHeader dateKey={dateKey} dailyTargets={dailyTargets} counts={dailyCounts[dateKey]} />
            <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {dayMessages.map((message) =>
            isHeld(message) ? (
              // Deliberate, already-made decision -- not swipeable, not
              // part of Approve All. Only actions here are un-holding it
              // (Approve, if the owner changes their mind) or removing it
              // for good (Delete, reusing the existing cleanup action).
              <motion.div
                key={message.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass rounded-2xl p-4 ring-1 ring-[var(--text-5)]/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/outreach/leads/${message.leadId}`}
                    className="text-sm font-semibold text-[var(--text-1)] underline-offset-2 hover:text-[var(--accent-from)] hover:underline"
                  >
                    {message.lead.businessName || "Unknown business"}
                  </Link>
                  {/* A held message that's ALSO permanently unreachable (e.g.
                      held via the failed-retry card's "Hold (unreachable)"
                      button after a no-Message-button failure) must keep
                      showing that fact here -- this used to be a generic
                      "On hold" card with a plain Approve button that quietly
                      let the same dead send through again. See
                      approveMessageAction's permanentlyUnreachableReason()
                      for the server-side guard this now backs up. */}
                  <span
                    className={
                      message.sendFailureReason
                        ? "rounded-full bg-[var(--status-hot)]/10 px-2 py-0.5 text-xs font-medium text-[var(--status-hot)]"
                        : "rounded-full bg-[var(--text-5)]/15 px-2 py-0.5 text-xs font-medium text-[var(--text-3)]"
                    }
                  >
                    {message.sendFailureReason ? "Can't be reached" : "On hold"}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-[var(--text-4)]">{message.editedBody || message.body}</p>
                <p className="mt-1.5 text-[11px] text-[var(--text-5)]">
                  {message.holdReason || message.sendFailureReason || "No reason recorded."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!message.sendFailureReason && (
                    // No Approve option once this is permanently unreachable
                    // on this channel -- re-approving can never succeed, so
                    // Delete (or contacting the lead on a different channel)
                    // is the only real next step.
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={() => approve(message)}
                      className="rounded-lg bg-[#4fd293]/15 px-3 py-1.5 text-xs font-semibold text-[#3fb87e] ring-1 ring-[#4fd293]/30 transition-colors hover:bg-[#4fd293]/25"
                    >
                      Approve
                    </motion.button>
                  )}
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => deleteHeld(message)}
                    className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
                  >
                    Delete
                  </motion.button>
                </div>
              </motion.div>
            ) : isFailedRetry(message) ? (
              // Distinct, non-swipeable card -- this is already approved,
              // not a pending decision, so Approve/Hold/edit don't apply.
              // Only action is a real retry of the actual send.
              <motion.div
                key={message.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass rounded-2xl p-4 ring-1 ring-[var(--status-hot)]/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/outreach/leads/${message.leadId}`}
                    className="text-sm font-semibold text-[var(--text-1)] underline-offset-2 hover:text-[var(--accent-from)] hover:underline"
                  >
                    {message.lead.businessName || "Unknown business"}
                  </Link>
                  <span className="rounded-full bg-[var(--status-hot)]/10 px-2 py-0.5 text-xs font-medium text-[var(--status-hot)]">
                    {/* Owner-requested 2026-09-13: distinguish a PERMANENT
                        failure (sendFailurePermanent -- e.g. no Message
                        button on LinkedIn/Instagram, or a recognized
                        permanent email reason like an invalid recipient or
                        a paused account) from a generic transient one
                        (most email failures: rate limits, one-off Resend/
                        network errors -- see isPermanentEmailFailureReason
                        in outreach-approvals.ts). The specific reason text
                        itself renders just below, not hardcoded here. */}
                    {message.sendFailurePermanent ? "Can't be reached" : "Failed to send"}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-[var(--text-4)]">{message.editedBody || message.body}</p>
                {message.sendFailureReason && (
                  <p className="mt-1.5 text-[11px] text-[var(--text-5)]">{message.sendFailureReason}</p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {message.sendFailurePermanent ? (
                    // A PERMANENT failure (e.g. no Message button, invalid
                    // recipient, paused account) will never succeed no
                    // matter how many times it's retried -- offering
                    // "Retry send" here would be misleading. Owner's own
                    // call 2026-09-13: "when it appears... as no message
                    // button I will press hold and ignore sending it" --
                    // Hold removes it from the sending queue for good
                    // (approvalStatus -> "held"), same action already used
                    // elsewhere in this file.
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={() => hold(message)}
                      className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
                    >
                      Hold (unreachable)
                    </motion.button>
                  ) : (
                    // Not flagged permanent -- for email this covers most
                    // real failures (rate limit, transient Resend/network
                    // error) where retrying is a real, meaningful action.
                    // Email-only server-side today (retryFailedEmailSendAction)
                    // -- a real LinkedIn/Instagram retry path is a separate,
                    // not-yet-built piece of work.
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={() => retry(message)}
                      className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
                    >
                      Retry send
                    </motion.button>
                  )}
                </div>
              </motion.div>
            ) : isApprovedSection(message) ? (
              // OWNER REQUEST 2026-10-06: a message already cleared to
              // send (manually or via the auto-approve toggle) -- not
              // swipeable, not part of Approve All, just a status card
              // with a De-approve button to pull it back into Awaiting if
              // it was approved by mistake or a decision changes. Only
              // shown when canDeapprove(message) is true (still genuinely
              // "pending" -- nothing has touched the real send yet); a
              // message already sending/queued/sent shows its real status
              // instead, since pulling it back at that point wouldn't
              // undo anything real.
              <motion.div
                key={message.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass rounded-2xl p-4 ring-1 ring-[#4fd293]/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <Link
                    href={`/outreach/leads/${message.leadId}`}
                    className="text-sm font-semibold text-[var(--text-1)] underline-offset-2 hover:text-[var(--accent-from)] hover:underline"
                  >
                    {message.lead.businessName || "Unknown business"}
                  </Link>
                  <span className="rounded-full bg-[#4fd293]/15 px-2 py-0.5 text-xs font-medium text-[#3fb87e]">
                    {message.sendStatus === "sent"
                      ? "Sent"
                      : message.sendStatus === "sending"
                        ? "Sending..."
                        : message.sendStatus === "queued_for_pacing"
                          ? "Queued"
                          : "Approved"}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-[var(--text-4)]">{message.editedBody || message.body}</p>
                {canDeapprove(message) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={() => deapprove(message)}
                      className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
                    >
                      De-approve
                    </motion.button>
                  </div>
                )}
              </motion.div>
            ) : (
            <DraggableCard key={message.id} onApprove={() => approve(message)} onHold={() => hold(message)}>
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/outreach/leads/${message.leadId}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="text-sm font-semibold text-[var(--text-1)] underline-offset-2 hover:text-[var(--accent-from)] hover:underline"
                >
                  {message.lead.businessName || "Unknown business"}
                </Link>
                <div className="flex shrink-0 items-center gap-1.5">
                  {message.isFollowup && (
                    <span className="rounded-full bg-[var(--accent-from)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-from)]">
                      Follow-up
                    </span>
                  )}
                  <span className="rounded-full border border-[var(--border-hairline-strong)] px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--text-4)]">
                    {/* Owner-requested 2026-09-26: show WHERE this company
                        was actually found, not just which channel this
                        message sends on -- an email lead can come from
                        Instagram or LinkedIn discovery (see scheduler.py's
                        _maybe_find_email(), which creates a separate
                        email-channel OutreachLead linked from whichever
                        platform's discovery found the company's website).
                        message.lead.platform is that ORIGINAL discovery
                        platform; only worth showing when it differs from
                        the channel this message itself sends on, so a
                        native Instagram/LinkedIn message doesn't get a
                        redundant "instagram - instagram" badge. */}
                    {message.channel}
                    {message.lead.platform && message.lead.platform !== message.channel
                      ? ` - ${message.lead.platform}`
                      : ""}
                  </span>
                </div>
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--text-5)]">
                Discovered {new Date(message.lead.discoveredAt).toLocaleString()}
              </p>

              <textarea
                defaultValue={message.editedBody || message.body}
                onChange={(e) => setDrafts((d) => ({ ...d, [message.id]: e.target.value }))}
                onPointerDown={(e) => e.stopPropagation()}
                rows={4}
                className="mt-3 w-full rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 p-3 text-sm text-[var(--text-2)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
              />

              <input
                type="text"
                placeholder="Reason for holding (optional)"
                value={holdReasons[message.id] || ""}
                onChange={(e) => setHoldReasons((d) => ({ ...d, [message.id]: e.target.value }))}
                onPointerDown={(e) => e.stopPropagation()}
                className="mt-2 w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-2.5 py-1.5 text-xs text-[var(--text-3)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => approve(message)}
                  className="rounded-lg bg-[#4fd293]/15 px-3 py-1.5 text-xs font-semibold text-[#3fb87e] ring-1 ring-[#4fd293]/30 transition-colors hover:bg-[#4fd293]/25"
                >
                  Approve
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => saveEdit(message)}
                  className="rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
                >
                  Save edit
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => hold(message)}
                  className="rounded-lg bg-[var(--surface-1)] px-3 py-1.5 text-xs font-semibold text-[var(--text-4)] transition-colors hover:bg-[var(--surface-2)]"
                >
                  Hold
                </motion.button>
              </div>
              <p className="mt-2 text-[11px] text-[var(--text-5)] md:hidden">Swipe right to approve, left to hold.</p>
            </DraggableCard>
            )
          )}
        </AnimatePresence>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
