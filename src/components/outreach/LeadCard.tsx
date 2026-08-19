"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

export interface LeadCardData {
  id: string;
  platform: string;
  businessName: string | null;
  industry: string | null;
  score: number | null;
  temperature: string | null;
  founderFound: boolean;
  founderName: string | null;
  weakPoints: string[];
  generatedMessage: string | null;
}

const TEMPERATURE_VARIANT: Record<string, "hot" | "warm" | "cold"> = {
  hot: "hot",
  warm: "warm",
  cold: "cold",
};

function TemperatureBadge({ temperature }: { temperature: string | null }) {
  if (!temperature) return null;
  const variant = TEMPERATURE_VARIANT[temperature] ?? "neutral";
  return (
    <span className="relative inline-flex">
      {temperature === "hot" && <HotBurst />}
      <Badge variant={variant} dot className="capitalize">
        {temperature}
      </Badge>
    </span>
  );
}

const PARTICLES = Array.from({ length: 8 }, (_, i) => {
  const angle = (i / 8) * Math.PI * 2;
  return { x: Math.cos(angle) * 26, y: Math.sin(angle) * 26 };
});

function HotBurst() {
  return (
    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {PARTICLES.map((p, i) => (
        <motion.span
          key={i}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0 }}
          transition={{ duration: 0.7, delay: 0.05 * i, ease: "easeOut" }}
          className="absolute h-1.5 w-1.5 rounded-full bg-[var(--status-hot)]"
        />
      ))}
    </span>
  );
}

export function LeadCard({ lead }: { lead: LeadCardData }) {
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    if (!lead.generatedMessage) return;
    await navigator.clipboard.writeText(lead.generatedMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="glass glass-hover rounded-2xl p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/outreach/leads/${lead.id}`}
            className="block truncate text-sm font-semibold text-[var(--text-1)] transition hover:text-[var(--accent-from)]"
          >
            {lead.businessName || "Unnamed business"}
          </Link>
          <p className="mt-0.5 truncate text-xs text-[var(--text-5)]">
            {lead.platform}
            {lead.industry ? ` · ${lead.industry}` : ""}
          </p>
        </div>
        <div className="flex min-w-0 shrink items-center gap-2">
          {lead.founderFound && lead.founderName && (
            <span className="inline-block max-w-[7rem] truncate rounded-full border border-[var(--accent-from)]/30 bg-[var(--accent-from)]/10 px-2 py-0.5 text-xs text-[var(--accent-from)] sm:max-w-[10rem]">
              {lead.founderName}
            </span>
          )}
          <TemperatureBadge temperature={lead.temperature} />
        </div>
      </div>

      {lead.score != null && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${lead.score * 10}%` }}
              transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
              className="h-full rounded-full bg-accent-gradient"
            />
          </div>
          <span className="text-xs font-medium tabular-nums text-[var(--text-4)]">{lead.score}/10</span>
        </div>
      )}

      {lead.weakPoints.length > 0 && (
        <ul className="mt-3 space-y-1">
          {lead.weakPoints.slice(0, 3).map((point) => (
            <li key={point} className="text-xs text-[var(--text-4)]">
              · {point}
            </li>
          ))}
          {lead.weakPoints.length > 3 && (
            <li className="text-xs text-[var(--text-5)]">+{lead.weakPoints.length - 3} more</li>
          )}
        </ul>
      )}

      {lead.generatedMessage && (
        <div className="mt-3 rounded-xl border border-[var(--border-hairline)] bg-[var(--surface-1)]/50 p-3">
          <p className={cn("text-xs text-[var(--text-4)]", "line-clamp-3")}>{lead.generatedMessage}</p>
          <button
            onClick={copyMessage}
            className="mt-2 text-xs font-medium text-[var(--text-3)] underline decoration-[var(--border-hairline-strong)] underline-offset-2 outline-none transition-colors hover:text-[var(--text-1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]"
          >
            {copied ? "Copied ✓" : "Copy message"}
          </button>
        </div>
      )}
    </motion.div>
  );
}
