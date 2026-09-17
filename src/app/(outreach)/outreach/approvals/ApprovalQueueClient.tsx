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

export function ApprovalQueueClient({ tenantId, initialMessages }: { tenantId: string; initialMessages: ApprovalMessage[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [holdReasons, setHoldReasons] = useState<Record<string, string>>({});
  const [, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "outreach_messages", tenantId, reload });

  const approve = (message: ApprovalMessage) => {
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    startTransition(async () => {
      const result = await approveMessageAction(message.id);
      if (!result.ok) {
        // The row was already optimistically removed above -- a blocked
        // approval (e.g. this message just became permanently unreachable
        // on its channel, see approveMessageAction's guard) must bring it
        // back into view rather than let it silently vanish looking approved.
        showToast({ title: "Approve failed", description: result.error, variant: "error" });
        reload();
        return;
      }
      showToast({
        title: "Approved",
        description: `${message.lead.businessName || "This lead"} (${message.channel}) is cleared to send.`,
        variant: "success",
      });
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
    const toApprove = messages.filter((m) => m.approvalStatus !== "held" && !isFailedRetry(m));
    if (toApprove.length === 0) return;
    setMessages((prev) => prev.filter((m) => m.approvalStatus === "held" || isFailedRetry(m)));
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

  const pendingCount = messages.filter((m) => m.approvalStatus !== "held" && !isFailedRetry(m)).length;

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
          <p className="mt-1 text-sm text-[var(--text-4)]">Nothing sends until you approve it here.</p>
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

      {messages.length > 1 && (
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={approveAll}
          className="mt-4 rounded-xl bg-accent-gradient px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-[var(--accent-from)]/20"
        >
          Approve All ({pendingCount})
        </motion.button>
      )}

      {messages.length === 0 && <EmptyState />}

      <div className="mt-6 space-y-4">
        <AnimatePresence mode="popLayout">
          {messages.map((message) =>
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
                    {message.channel}
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
  );
}
