"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { KpiCard } from "@/components/ui/KpiCard";
import { Badge } from "@/components/ui/Badge";
import { Toggle } from "@/components/ui/Toggle";
import Link from "next/link";
import { MessageSquare, CheckCircle2, Sparkles } from "lucide-react";
import { toggleChannelConnectionAction } from "@/lib/actions/agency-integrations";
import { getDictionary, type UiLanguage } from "@/lib/i18n";

interface ChannelRow {
  provider: string;
  status: string;
  displayName: string | null;
}

interface AiSettingsSummary {
  tone: string;
  primaryLanguage: string;
  allowEnglish: boolean;
  approvalRequired: boolean;
  model: string;
  qualificationRules: string;
}

export function AiControlClient({
  channels,
  settings,
  activeConversations,
  pendingApprovals,
  lang,
}: {
  channels: ChannelRow[];
  settings: AiSettingsSummary;
  activeConversations: number;
  pendingApprovals: number;
  lang: UiLanguage;
}) {
  const t = getDictionary(lang);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleToggle = (provider: string, connect: boolean) => {
    startTransition(async () => {
      await toggleChannelConnectionAction(provider as "WHATSAPP" | "INSTAGRAM" | "FACEBOOK", connect);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.aiControl.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          {t.aiControl.subtitle}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiCard label={t.aiControl.kpiActiveConversations} value={activeConversations.toString()} icon={<MessageSquare className="h-3.5 w-3.5" />} highlight />
        <KpiCard label={t.aiControl.kpiPendingApprovals} value={pendingApprovals.toString()} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
        <KpiCard label={t.aiControl.kpiModel} value={settings.model} icon={<Sparkles className="h-3.5 w-3.5" />} />
      </div>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>{t.aiControl.connectedChannels}</CardTitle>
            <CardDescription>{t.aiControl.connectedChannelsSubtitle}</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-3">
          {channels.map((c) => (
            <div key={c.provider} className="flex items-center justify-between rounded-lg border border-[var(--border-hairline)] p-3">
              <div className="flex items-center gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--text-1)]">{t.channel[c.provider as keyof typeof t.channel] ?? c.provider}</p>
                  <p className="text-xs text-[var(--text-4)]">{c.displayName ?? t.aiControl.notConnected}</p>
                </div>
                <Badge variant={c.status === "CONNECTED" ? "success" : "outline"}>{c.status}</Badge>
              </div>
              <Toggle
                checked={c.status === "CONNECTED"}
                onCheckedChange={(checked) => handleToggle(c.provider, checked)}
                disabled={pending}
              />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--text-5)]">
          {t.aiControl.manageHintPrefix}{" "}
          <Link href="/agency/integrations" className="text-[var(--accent-from)]">
            {t.aiControl.integrationsLink}
          </Link>{" "}
          {t.aiControl.manageHintSuffix}
        </p>
      </Card>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>{t.aiControl.currentConfiguration}</CardTitle>
            <CardDescription>
              {t.aiControl.currentConfigurationSubtitlePrefix}{" "}
              <Link href="/agency/settings" className="text-[var(--accent-from)]">
                {t.aiControl.settingsLink}
              </Link>{" "}
              {t.aiControl.manageHintSuffix}
            </CardDescription>
          </div>
        </CardHeader>
        <dl className="space-y-2 text-sm">
          <Row label={t.aiControl.tone} value={settings.tone} />
          <Row label={t.aiControl.primaryLanguage} value={settings.primaryLanguage === "AR" ? t.aiControl.arabic : t.aiControl.english} />
          <Row label={t.aiControl.allowEnglishFallback} value={settings.allowEnglish ? t.aiControl.yes : t.aiControl.no} />
          <Row label={t.aiControl.humanApprovalRequired} value={settings.approvalRequired ? t.aiControl.approvalAllReplies : t.aiControl.approvalSensitiveOnly} />
        </dl>
        {settings.qualificationRules && (
          <div className="mt-3 border-t border-[var(--border-hairline)] pt-3">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--text-4)]">{t.aiControl.qualificationRules}</p>
            <p className="text-sm text-[var(--text-2)] whitespace-pre-line">{settings.qualificationRules}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-hairline)] py-1.5 last:border-0">
      <dt className="text-[var(--text-4)]">{label}</dt>
      <dd className="text-[var(--text-1)] font-medium">{value}</dd>
    </div>
  );
}
