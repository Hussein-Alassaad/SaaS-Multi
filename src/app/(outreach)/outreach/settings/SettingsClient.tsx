"use client";

import { useState, useTransition } from "react";
import { motion } from "framer-motion";
import { useToast } from "@/components/ui/Toast";
import { saveOutreachSettingsAction } from "@/lib/actions/outreach-settings";

const section = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)]/50 px-3 py-2.5 text-sm text-[var(--text-1)] outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]";
const labelClass = "text-xs font-medium uppercase tracking-wide text-[var(--text-5)]";

export interface OutreachSettingsData {
  businessName: string;
  businessDescription: string;
  targetNiche: string;
  targetIndustry: string;
  targetLocation: string;
  targetBusinessType: string;
  targetCompanySizeMin: number | null;
  targetCompanySizeMax: number | null;
  targetNeeds: string[];
  outreachLanguages: string[];
  messageStyle: string;
  styleDurationDays: number;
  defaultRecontactGapDays: number;
  maxContactsPerLead: number;
  approvalRequired: boolean;
  approvalReminderHours: number;
  whatsappRecipient1: string | null;
  whatsappRecipient2: string | null;
}

export function SettingsClient({ initial }: { initial: OutreachSettingsData }) {
  const [settings, setSettings] = useState(initial);
  const [, startTransition] = useTransition();
  const { showToast } = useToast();

  function set<K extends keyof OutreachSettingsData>(field: K, value: OutreachSettingsData[K]) {
    setSettings((s) => ({ ...s, [field]: value }));
  }

  const save = () => {
    startTransition(async () => {
      const result = await saveOutreachSettingsAction(settings);
      if (!result.ok) {
        showToast({ title: "Save failed", description: result.error, variant: "error" });
        return;
      }
      showToast({ title: "Saved", variant: "success" });
    });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <motion.header initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">
          <span className="text-gradient">Settings</span>
        </h1>
        <p className="mt-1 text-sm text-[var(--text-4)]">Every control here is live -- changes apply on the agent&apos;s next run.</p>
      </motion.header>

      <motion.section {...section} transition={{ delay: 0.02 }} className="glass mt-6 space-y-4 rounded-2xl p-4">
        <p className="text-sm font-semibold text-[var(--text-2)]">Your business</p>
        <p className="text-xs text-[var(--text-5)]">
          The AI signs every outreach message as this business -- get this right before running any campaign.
        </p>
        <label className="block">
          <span className={labelClass}>Business name</span>
          <input
            className={inputClass}
            placeholder="e.g. Nexaris"
            value={settings.businessName}
            onChange={(e) => set("businessName", e.target.value)}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Business description</span>
          <textarea
            className={inputClass}
            rows={3}
            placeholder="e.g. a CGI, VFX, and 3D anamorphic billboard agency"
            value={settings.businessDescription}
            onChange={(e) => set("businessDescription", e.target.value)}
          />
          <p className="mt-1 text-xs text-[var(--text-5)]">
            One short phrase describing what you do -- used directly in the AI&apos;s outreach messages.
          </p>
        </label>
      </motion.section>

      <motion.section {...section} transition={{ delay: 0.05 }} className="glass mt-4 space-y-4 rounded-2xl p-4">
        <p className="text-sm font-semibold text-[var(--text-2)]">Targeting</p>
        <label className="block">
          <span className={labelClass}>Target niche</span>
          <input className={inputClass} value={settings.targetNiche} onChange={(e) => set("targetNiche", e.target.value)} />
        </label>
        <label className="block">
          <span className={labelClass}>Target industry</span>
          <input className={inputClass} value={settings.targetIndustry} onChange={(e) => set("targetIndustry", e.target.value)} />
        </label>
        <label className="block">
          <span className={labelClass}>Target location</span>
          <input className={inputClass} value={settings.targetLocation} onChange={(e) => set("targetLocation", e.target.value)} />
        </label>
        <label className="block">
          <span className={labelClass}>Target business type</span>
          <input
            className={inputClass}
            value={settings.targetBusinessType}
            onChange={(e) => set("targetBusinessType", e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={labelClass}>Min company size</span>
            <input
              type="number"
              className={inputClass}
              placeholder="Optional"
              value={settings.targetCompanySizeMin ?? ""}
              onChange={(e) => set("targetCompanySizeMin", e.target.value === "" ? null : Number(e.target.value))}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Max company size</span>
            <input
              type="number"
              className={inputClass}
              placeholder="Optional"
              value={settings.targetCompanySizeMax ?? ""}
              onChange={(e) => set("targetCompanySizeMax", e.target.value === "" ? null : Number(e.target.value))}
            />
          </label>
        </div>
        <label className="block">
          <span className={labelClass}>Target needs / pain points (comma-separated)</span>
          <input
            className={inputClass}
            placeholder="e.g. security systems, cameras"
            value={settings.targetNeeds.join(", ")}
            onChange={(e) =>
              set(
                "targetNeeds",
                e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
              )
            }
          />
          <p className="mt-1 text-xs text-[var(--text-5)]">
            Guides the agent toward businesses that plausibly need these -- e.g. companies needing security and camera systems.
          </p>
        </label>
        <label className="block">
          <span className={labelClass}>Outreach languages (comma-separated)</span>
          <input
            className={inputClass}
            value={settings.outreachLanguages.join(", ")}
            onChange={(e) =>
              set(
                "outreachLanguages",
                e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
              )
            }
          />
        </label>
      </motion.section>

      <motion.section {...section} transition={{ delay: 0.1 }} className="glass mt-4 space-y-4 rounded-2xl p-4">
        <p className="text-sm font-semibold text-[var(--text-2)]">Message style</p>
        <label className="block">
          <span className={labelClass}>Style</span>
          <select
            className={inputClass}
            value={settings.messageStyle}
            onChange={(e) => set("messageStyle", e.target.value)}
          >
            <option value="discovery">Discovery (softer, curiosity-driven)</option>
            <option value="direct">Direct (names the weak point outright)</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Rotate style after (days)</span>
          <input
            type="number"
            className={inputClass}
            value={settings.styleDurationDays}
            onChange={(e) => set("styleDurationDays", Number(e.target.value))}
          />
        </label>
      </motion.section>

      <motion.section {...section} transition={{ delay: 0.15 }} className="glass mt-4 space-y-4 rounded-2xl p-4">
        <p className="text-sm font-semibold text-[var(--text-2)]">Contact rules</p>
        <label className="block">
          <span className={labelClass}>Default re-contact gap (days)</span>
          <input
            type="number"
            className={inputClass}
            value={settings.defaultRecontactGapDays}
            onChange={(e) => set("defaultRecontactGapDays", Number(e.target.value))}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Max contacts per lead</span>
          <input
            type="number"
            className={inputClass}
            value={settings.maxContactsPerLead}
            onChange={(e) => set("maxContactsPerLead", Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-3)]">
          <input
            type="checkbox"
            checked={settings.approvalRequired}
            onChange={(e) => set("approvalRequired", e.target.checked)}
          />
          Require approval before sending (hard gate)
        </label>
        {!settings.approvalRequired && (
          <p className="rounded-lg border border-[var(--status-hot)]/30 bg-[var(--status-hot)]/10 px-3 py-2 text-xs text-[var(--status-hot)]">
            Off: the AI sends LinkedIn and email messages automatically as soon as they&apos;re generated -- no
            human reviews them first. Instagram still always requires a manual send (platform policy), regardless
            of this setting.
          </p>
        )}
        <label className="block">
          <span className={labelClass}>Remind me about pending approvals after (hours)</span>
          <input
            type="number"
            className={inputClass}
            value={settings.approvalReminderHours}
            onChange={(e) => set("approvalReminderHours", Number(e.target.value))}
          />
        </label>
      </motion.section>

      <motion.section {...section} transition={{ delay: 0.2 }} className="glass mt-4 space-y-4 rounded-2xl p-4">
        <p className="text-sm font-semibold text-[var(--text-2)]">WhatsApp notification recipients</p>
        <label className="block">
          <span className={labelClass}>Recipient 1</span>
          <input
            className={inputClass}
            placeholder="+961..."
            value={settings.whatsappRecipient1 ?? ""}
            onChange={(e) => set("whatsappRecipient1", e.target.value)}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Recipient 2</span>
          <input
            className={inputClass}
            placeholder="+961..."
            value={settings.whatsappRecipient2 ?? ""}
            onChange={(e) => set("whatsappRecipient2", e.target.value)}
          />
        </label>
      </motion.section>

      <div className="mt-4 flex items-center gap-3">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={save}
          className="rounded-xl bg-accent-gradient px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[var(--accent-from)]/20"
        >
          Save settings
        </motion.button>
      </div>
    </div>
  );
}
