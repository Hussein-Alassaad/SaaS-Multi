"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { saveLeadNotesAction, scheduleFollowUpAction } from "@/lib/actions/outreach-lead-detail";

const section = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

const TEMPERATURE_VARIANT: Record<string, "hot" | "warm" | "cold"> = { hot: "hot", warm: "warm", cold: "cold" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">{label}</p>
      <div className="mt-0.5 text-sm text-[var(--text-2)]">{children}</div>
    </div>
  );
}

function ListField({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">{label}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="text-sm text-[var(--text-3)]">
            · {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface LeadDetailData {
  id: string;
  businessName: string | null;
  platform: string;
  status: string;
  temperature: string | null;
  score: number | null;
  industry: string | null;
  companySize: string | null;
  revenueTier: string | null;
  founderFound: boolean;
  founderName: string | null;
  founderSourcePhrase: string | null;
  whatsappFound: boolean;
  whatsappNumber: string | null;
  contactEmail: string | null;
  website: string | null;
  profileUrl: string | null;
  contactCount: number;
  weakPoints: string[];
  aiOpportunities: string[];
  scoreReasoning: string | null;
  generatedMessage: string | null;
  messageStyleUsed: string | null;
  notes: string | null;
}

export interface StageHistoryItem {
  id: string;
  changedAt: string;
  fromStage: string | null;
  toStage: string;
  changedBy: string;
}

export function LeadDetailClient({ lead, history }: { lead: LeadDetailData; history: StageHistoryItem[] }) {
  const [notes, setNotes] = useState(lead.notes ?? "");
  const [followupEnabled, setFollowupEnabled] = useState(false);
  const [followupAt, setFollowupAt] = useState("");
  const [, startTransition] = useTransition();
  const { showToast } = useToast();

  const saveNotes = () => {
    startTransition(async () => {
      const result = await saveLeadNotesAction(lead.id, notes);
      if (!result.ok) {
        showToast({ title: "Save failed", description: result.error, variant: "error" });
        return;
      }
      showToast({ title: "Saved", variant: "success" });
    });
  };

  const scheduleFollowup = () => {
    if (!followupAt) return;
    startTransition(async () => {
      const result = await scheduleFollowUpAction(lead.id, followupEnabled, followupAt);
      if (!result.ok) {
        showToast({ title: "Could not schedule", description: result.error, variant: "error" });
        return;
      }
      showToast({ title: "Follow-up scheduled", variant: "success" });
    });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-start justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
            {lead.businessName || "Unnamed business"}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-4)]">
            {lead.platform} · status: {lead.status}
          </p>
        </div>
        {lead.temperature && (
          <Badge variant={TEMPERATURE_VARIANT[lead.temperature] ?? "neutral"} dot className="capitalize">
            {lead.temperature}
          </Badge>
        )}
      </motion.header>

      <motion.div {...section} transition={{ delay: 0.05 }} className="glass mt-6 grid grid-cols-2 gap-4 rounded-2xl p-4">
        <Field label="Score">{lead.score != null ? `${lead.score}/10` : null}</Field>
        <Field label="Industry">{lead.industry}</Field>
        <Field label="Company size">{lead.companySize}</Field>
        <Field label="Revenue tier">{lead.revenueTier}</Field>
        <Field label="Founder">
          {lead.founderFound ? `${lead.founderName} ("${lead.founderSourcePhrase}")` : "Not found"}
        </Field>
        <Field label="WhatsApp">{lead.whatsappFound ? lead.whatsappNumber : "Not found"}</Field>
        <Field label="Email">{lead.contactEmail}</Field>
        <Field label="Website">
          {lead.website && (
            <a href={lead.website} target="_blank" rel="noreferrer" className="underline">
              {lead.website}
            </a>
          )}
        </Field>
        <Field label="Profile">
          {lead.profileUrl && (
            <a href={lead.profileUrl} target="_blank" rel="noreferrer" className="underline">
              Open profile →
            </a>
          )}
        </Field>
        <Field label="Contacts so far">{lead.contactCount}</Field>
      </motion.div>

      <motion.div {...section} transition={{ delay: 0.1 }} className="glass mt-4 space-y-4 rounded-2xl p-4">
        <ListField label="Weak points" items={lead.weakPoints} />
        <ListField label="AI opportunities" items={lead.aiOpportunities} />
        {lead.scoreReasoning && <Field label="Score reasoning">{lead.scoreReasoning}</Field>}
      </motion.div>

      {lead.generatedMessage && (
        <motion.div {...section} transition={{ delay: 0.15 }} className="glass mt-4 rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">
            Message {lead.messageStyleUsed ? `(${lead.messageStyleUsed})` : ""}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-[var(--text-3)]">{lead.generatedMessage}</p>
        </motion.div>
      )}

      <motion.div {...section} transition={{ delay: 0.2 }} className="glass mt-4 rounded-2xl p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">Notes</p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 p-3 text-sm text-[var(--text-2)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
        />
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={saveNotes}
          className="mt-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
        >
          Save notes
        </motion.button>
      </motion.div>

      <motion.div {...section} transition={{ delay: 0.25 }} className="glass mt-4 rounded-2xl p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">Follow-up</p>
        <p className="mt-1 text-xs text-[var(--text-5)]">On/off and timing are your call -- the agent never picks a delay.</p>
        <label className="mt-3 flex items-center gap-2 text-sm text-[var(--text-3)]">
          <input type="checkbox" checked={followupEnabled} onChange={(e) => setFollowupEnabled(e.target.checked)} />
          Enable follow-up
        </label>
        <input
          type="datetime-local"
          value={followupAt}
          onChange={(e) => setFollowupAt(e.target.value)}
          className="mt-2 w-full rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 p-2 text-sm text-[var(--text-2)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
        />
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={scheduleFollowup}
          className="mt-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-2)] transition-colors hover:bg-[var(--surface-3)]"
        >
          Schedule
        </motion.button>
      </motion.div>

      {history.length > 0 && (
        <motion.div {...section} transition={{ delay: 0.3 }} className="glass mt-4 rounded-2xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-5)]">Stage history</p>
          <ul className="mt-2 space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="text-xs text-[var(--text-4)]">
                {new Date(h.changedAt).toLocaleString()} — {h.fromStage || "start"} → {h.toStage} ({h.changedBy})
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </div>
  );
}
