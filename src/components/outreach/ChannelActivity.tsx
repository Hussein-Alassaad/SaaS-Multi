"use client";

import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useOutreachRealtime } from "@/lib/outreach/realtime";

export interface ChannelMessage {
  id: string;
  body: string;
  editedBody: string | null;
  sendStatus: string;
  sentAt: string | null;
  createdAt: string;
  lead: { id: string; businessName: string | null };
}

export interface ChannelReply {
  id: string;
  body: string;
  repliedAt: string;
  lead: { businessName: string | null };
}

export interface ChannelAccount {
  id: string;
  label: string;
  status: string;
  warningReason: string | null;
  dailyLimit: number;
  warmupCurrentLimit: number;
}

const STATUS_RING: Record<string, string> = {
  active: "ring-[#4fd293]/30 bg-[#4fd293]/10 text-[#3fb87e]",
  warned: "ring-[var(--status-warm)]/30 bg-[var(--status-warm)]/10 text-[var(--status-warm)]",
  paused: "ring-[var(--status-hot)]/30 bg-[var(--status-hot)]/10 text-[var(--status-hot)]",
};

const SEND_STATUS_STYLE: Record<string, string> = {
  sent: "bg-[#4fd293]/10 text-[#3fb87e]",
  failed: "bg-[var(--status-hot)]/10 text-[var(--status-hot)]",
};

/**
 * Read-only "what has this channel actually done" view -- used by both
 * LinkedIn Activity and Email Outreach, since both auto-send once approved
 * (unlike Instagram, which needs a human click per message; see
 * InstagramManualSendClient). Shares one component parameterized by
 * channel/title/subtitle rather than duplicating the page twice.
 */
export function ChannelActivity({
  tenantId,
  channel,
  title,
  accentTitle,
  subtitle,
  messages,
  replies,
  accounts,
}: {
  tenantId: string;
  channel: "linkedin" | "email";
  title: string;
  accentTitle: string;
  subtitle: string;
  messages: ChannelMessage[];
  replies: ChannelReply[];
  accounts: ChannelAccount[];
}) {
  const router = useRouter();
  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "outreach_messages", tenantId, reload });
  useOutreachRealtime({ table: "outreach_replies", tenantId, reload, debounceMs: 500 });
  useOutreachRealtime({ table: "outreach_accounts", tenantId, reload, debounceMs: 500 });

  const sentCount = messages.filter((m) => m.sendStatus === "sent").length;

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          {title ? `${title} ` : ""}
          <span className="text-gradient">{accentTitle}</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">{subtitle}</p>
      </motion.header>

      {accounts.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {accounts.map((a) => (
            <div key={a.id} className="glass rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-[var(--text-1)]">{a.label}</p>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ring-1",
                    STATUS_RING[a.status] ?? "ring-[var(--border-hairline)] bg-[var(--surface-2)] text-[var(--text-4)]"
                  )}
                >
                  {a.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--text-4)]">
                {a.warmupCurrentLimit ?? "—"}/{a.dailyLimit ?? "—"} daily limit
              </p>
              {a.warningReason && <p className="mt-1 text-xs text-[var(--status-warm)]">{a.warningReason}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-4)]">
          Sent messages <span className="text-[var(--text-5)]">({sentCount})</span>
        </h2>
      </div>
      {messages.length === 0 && <p className="mt-4 text-sm text-[var(--text-4)]">No {channel} messages yet.</p>}
      <div className="mt-3 space-y-2">
        <AnimatePresence mode="popLayout">
          {messages.map((m) => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="glass glass-hover rounded-xl p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <Link
                  href={`/outreach/leads/${m.lead.id}`}
                  className="truncate text-sm font-medium text-[var(--text-1)] hover:text-[var(--accent-from)]"
                >
                  {m.lead.businessName || "Unnamed business"}
                </Link>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
                    SEND_STATUS_STYLE[m.sendStatus] ?? "bg-[var(--surface-2)] text-[var(--text-4)]"
                  )}
                >
                  {m.sendStatus}
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 text-xs text-[var(--text-4)]">{m.editedBody || m.body}</p>
              <p className="mt-1.5 text-[11px] text-[var(--text-5)]">
                {m.sentAt ? `Sent ${new Date(m.sentAt).toLocaleString()}` : `Created ${new Date(m.createdAt).toLocaleString()}`}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-4)]">
          Replies <span className="text-[var(--text-5)]">({replies.length})</span>
        </h2>
      </div>
      {replies.length === 0 && <p className="mt-4 text-sm text-[var(--text-4)]">No replies detected yet.</p>}
      <div className="mt-3 space-y-2">
        <AnimatePresence mode="popLayout">
          {replies.map((r) => (
            <motion.div
              key={r.id}
              layout
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-1)]/40 p-2.5"
            >
              <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-5)]">
                <span>{r.lead.businessName || "Unknown lead"}</span>
                <span>{new Date(r.repliedAt).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--text-2)]">{r.body}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
