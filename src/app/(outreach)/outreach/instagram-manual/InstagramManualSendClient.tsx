"use client";

import { useState, useTransition, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useOutreachRealtime } from "@/lib/outreach/realtime";
import { markInstagramSentAction } from "@/lib/actions/outreach-channels";

export interface ManualSendMessage {
  id: string;
  body: string;
  editedBody: string | null;
  lead: { id: string; businessName: string | null; profileUrl: string | null };
}

export function InstagramManualSendClient({ tenantId, initialMessages }: { tenantId: string; initialMessages: ManualSendMessage[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  const reload = useCallback(() => router.refresh(), [router]);
  useOutreachRealtime({ table: "outreach_messages", tenantId, reload });

  const markSent = (message: ManualSendMessage) => {
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
    startTransition(async () => {
      const result = await markInstagramSentAction(message.id);
      if (!result.ok) {
        showToast({ title: "Failed to mark as sent", description: result.error, variant: "error" });
        return;
      }
      showToast({ title: "Marked as sent", variant: "success" });
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          Instagram — <span className="text-gradient">Manual Send</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">
          Instagram never auto-sends. Send these by hand, then mark them sent.
        </p>
      </motion.header>

      {messages.length === 0 && (
        <p className="mt-6 text-sm text-[var(--text-4)]">Nothing queued for manual send right now.</p>
      )}

      <div className="mt-6 space-y-4">
        <AnimatePresence mode="popLayout">
          {messages.map((message) => (
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

              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={() => markSent(message)}
                className="mt-3 rounded-lg bg-[#4fd293]/15 px-3 py-1.5 text-xs font-semibold text-[#3fb87e] ring-1 ring-[#4fd293]/30 transition-colors hover:bg-[#4fd293]/25"
              >
                Mark as Sent
              </motion.button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
