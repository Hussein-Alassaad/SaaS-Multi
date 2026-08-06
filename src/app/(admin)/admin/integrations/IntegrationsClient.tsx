"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils";
import {
  Bot,
  Sparkles,
  Gem,
  Mail,
  Database,
  Cloud,
  HardDrive,
  MessageCircle,
  Phone,
  Send,
  Webhook,
  type LucideIcon,
} from "lucide-react";

const PROVIDER_META: Record<string, { icon: LucideIcon; label: string }> = {
  OPENAI: { icon: Bot, label: "AI Model Provider" },
  CLAUDE: { icon: Sparkles, label: "AI Model Provider" },
  GEMINI: { icon: Gem, label: "AI Model Provider" },
  SMTP: { icon: Mail, label: "Transactional Email" },
  SUPABASE: { icon: Database, label: "Database / Auth" },
  CLOUDFLARE: { icon: Cloud, label: "CDN / DNS" },
  STORAGE: { icon: HardDrive, label: "Object Storage" },
  META: { icon: MessageCircle, label: "Social / Ads" },
  WHATSAPP: { icon: Phone, label: "Messaging" },
  RESEND: { icon: Send, label: "Transactional Email" },
  WEBHOOK: { icon: Webhook, label: "Outbound Events" },
};

interface IntegrationRow {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  lastSyncAt: string | null;
  configSummary: string;
}

export function IntegrationsClient({ integrations }: { integrations: IntegrationRow[] }) {
  const [state, setState] = useState(Object.fromEntries(integrations.map((i) => [i.id, i.enabled])));

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {integrations.map((i) => {
        const meta = PROVIDER_META[i.provider] ?? { icon: Webhook, label: "Integration" };
        const Icon = meta.icon;
        return (
          <Card key={i.id}>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <div className="rounded-lg bg-[var(--surface-2)] p-2 text-[var(--text-3)]">
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle>{i.name}</CardTitle>
                  <CardDescription>{meta.label}</CardDescription>
                </div>
              </div>
              <Toggle checked={state[i.id]} onCheckedChange={(v) => setState((s) => ({ ...s, [i.id]: v }))} />
            </CardHeader>
            <div className="flex items-center justify-between text-xs text-[var(--text-5)]">
              <span className="truncate">{i.configSummary || "Not configured"}</span>
              <Badge variant={state[i.id] ? "success" : "neutral"}>{state[i.id] ? "Connected" : "Disabled"}</Badge>
            </div>
            {i.lastSyncAt && (
              <p className="mt-2 text-xs text-[var(--text-5)]">Last synced {formatDateTime(i.lastSyncAt)}</p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
