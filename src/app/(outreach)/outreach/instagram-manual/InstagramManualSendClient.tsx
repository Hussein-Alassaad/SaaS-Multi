"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOutreachRealtime } from "@/lib/outreach/realtime";

export interface QueuedMessage {
  id: string;
  body: string;
  editedBody: string | null;
  lead: { id: string; businessName: string | null; profileUrl: string | null };
}

export interface LeadSummary {
  id: string;
  businessName: string | null;
  profileUrl: string | null;
}

type Tab = "toContact" | "contacted" | "replied";

function EmptyState({ label }: { label: string }) {
  return <p className="mt-6 text-sm text-[var(--text-4)]">{label}</p>;
}

export function InstagramManualSendClient({
  tenantId,
  toContact,
  contacted,
  replied,
}: {
  tenantId: string;
  toContact: QueuedMessage[];
  contacted: LeadSummary[];
  replied: LeadSummary[];
}) {
  const [tab, setTab] = useState<Tab>("toContact");
  const router = useRouter();

  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "outreach_messages", tenantId, reload });
  useOutreachRealtime({ table: "outreach_leads", tenantId, reload });

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          Instagram — <span className="text-gradient">Activity</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">
          The agent sends these automatically once approved. Replies are answered from{" "}
          <Link href="/outreach/replies" className="underline hover:text-[var(--text-1)]">
            Reply Here
          </Link>
          .
        </p>
      </motion.header>

      <div className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--surface-1)]/50 p-1">
        <button
          type="button"
          onClick={() => setTab("toContact")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            tab === "toContact" ? "bg-[var(--surface-2)] text-[var(--text-1)]" : "text-[var(--text-4)]"
          }`}
        >
          To Contact ({toContact.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("contacted")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            tab === "contacted" ? "bg-[var(--surface-2)] text-[var(--text-1)]" : "text-[var(--text-4)]"
          }`}
        >
          Contacted ({contacted.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("replied")}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            tab === "replied" ? "bg-[var(--surface-2)] text-[var(--text-1)]" : "text-[var(--text-4)]"
          }`}
        >
          Replied ({replied.length})
        </button>
      </div>

      {tab === "toContact" && (
        <div className="mt-6 space-y-4">
          {toContact.length === 0 && <EmptyState label="Nothing waiting to be sent right now." />}
          <AnimatePresence mode="popLayout">
            {toContact.map((message) => (
              <motion.div
                key={message.id}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass glass-hover rounded-2xl p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-1)]">{message.lead.businessName || "Unknown business"}</p>
                  {message.lead.profileUrl && (
                    <a
                      href={message.lead.profileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-[var(--text-4)] underline hover:text-[var(--text-1)]"
                    >
                      Open profile →
                    </a>
                  )}
                </div>
                <p className="mt-3 whitespace-pre-wrap rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)]/50 p-3 text-sm text-[var(--text-3)]">
                  {message.editedBody || message.body}
                </p>
                <p className="mt-2 text-xs text-[var(--text-5)]">Approved — waiting for the agent&apos;s next send pass.</p>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {tab === "contacted" && (
        <div className="mt-6 space-y-2">
          {contacted.length === 0 && <EmptyState label="No leads contacted yet." />}
          {contacted.map((lead) => (
            <div key={lead.id} className="glass flex items-center justify-between gap-3 rounded-xl p-3">
              <p className="text-sm text-[var(--text-1)]">{lead.businessName || "Unknown business"}</p>
              {lead.profileUrl && (
                <a href={lead.profileUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--text-4)] underline hover:text-[var(--text-1)]">
                  Open profile →
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "replied" && (
        <div className="mt-6 space-y-2">
          {replied.length === 0 && <EmptyState label="No replies yet." />}
          {replied.map((lead) => (
            <Link
              key={lead.id}
              href="/outreach/replies"
              className="glass glass-hover flex items-center justify-between gap-3 rounded-xl p-3 transition-colors"
            >
              <p className="text-sm text-[var(--text-1)]">{lead.businessName || "Unknown business"}</p>
              <span className="text-xs text-[var(--text-4)]">Open in Reply Here →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
