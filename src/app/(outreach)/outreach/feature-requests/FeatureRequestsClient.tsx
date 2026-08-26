"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Modal } from "@/components/ui/Modal";
import { formatDate } from "@/lib/utils";
import { submitOutreachFeatureRequestAction } from "@/lib/actions/outreach-feature-requests";
import { Plus, MessageSquarePlus } from "lucide-react";

export interface OutreachFeatureRequestRow {
  id: string;
  title: string;
  description: string;
  status: string;
  filedByName: string | null;
  createdAt: string;
}

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-3 py-2.5 text-sm text-[var(--text-1)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]";

const STATUS_STYLE: Record<string, string> = {
  NEW: "border-[var(--border-hairline-strong)] bg-[var(--surface-2)]/60 text-[var(--text-3)]",
  UNDER_REVIEW: "border-[var(--status-warm)]/30 bg-[var(--status-warm)]/10 text-[var(--status-warm)]",
  PLANNED: "border-[var(--accent-from)]/30 bg-[var(--accent-from)]/10 text-[var(--accent-from)]",
  COMPLETED: "border-[#4fd293]/30 bg-[#4fd293]/10 text-[#3fb87e]",
  REJECTED: "border-[var(--status-hot)]/30 bg-[var(--status-hot)]/10 text-[var(--status-hot)]",
};

export function FeatureRequestsClient({ requests }: { requests: OutreachFeatureRequestRow[] }) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = () => {
    if (!form.title.trim() || !form.description.trim()) {
      setError("Title and description are required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await submitOutreachFeatureRequestAction(form);
      if (!result.ok) {
        setError(result.error ?? "Failed to submit.");
        return;
      }
      setForm({ title: "", description: "" });
      setModalOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
            <span className="text-gradient">Feature Requests</span>
          </h1>
          <p className="mt-1 text-sm text-[var(--text-4)]">
            Need something the platform doesn&apos;t do yet? Tell us directly -- it goes straight to the team building it.
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => {
            setForm({ title: "", description: "" });
            setError(null);
            setModalOpen(true);
          }}
          className="flex items-center gap-1.5 rounded-xl bg-accent-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[var(--accent-from)]/20"
        >
          <Plus className="h-3.5 w-3.5" />
          New request
        </motion.button>
      </motion.header>

      {requests.length === 0 ? (
        <div className="glass mt-6 flex flex-col items-center justify-center rounded-2xl py-12 text-center">
          <MessageSquarePlus className="mb-3 h-8 w-8 text-[var(--text-5)]" />
          <p className="text-sm text-[var(--text-4)]">No requests filed yet. Submit one whenever you need something.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          <AnimatePresence mode="popLayout">
            {requests.map((r) => (
              <motion.div
                key={r.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="glass rounded-xl p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--text-1)]">{r.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-4)]">{r.description}</p>
                    <p className="mt-1 text-[10px] text-[var(--text-5)]">Filed {formatDate(r.createdAt)}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[r.status] ?? STATUS_STYLE.NEW}`}
                  >
                    {r.status.replace(/_/g, " ")}
                  </span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Modal open={modalOpen} onOpenChange={setModalOpen} title="New feature request">
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">Title</span>
            <input
              className={inputClass}
              placeholder="e.g. Add a Slack notification for hot leads"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">Description</span>
            <textarea
              className={inputClass}
              rows={4}
              placeholder="What do you need, and why?"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
          <motion.button
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            disabled={pending}
            onClick={handleSubmit}
            className="w-full rounded-xl bg-accent-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[var(--accent-from)]/20 disabled:opacity-60"
          >
            {pending ? "Submitting..." : "Submit request"}
          </motion.button>
        </div>
      </Modal>
    </div>
  );
}
