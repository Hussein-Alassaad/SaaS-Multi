import { MessageSquare, Flame, CheckCircle2, CalendarClock, Users } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { timeAgo } from "@/lib/utils";
import { getAgencyDashboardPageData } from "@/lib/agency/dashboard";
import { getTenantSession } from "@/lib/auth";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import Link from "next/link";

export default async function AgencyDashboardPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";
  const t = getDictionary(lang);

  // One withTenant() scope for both reads -- see getAgencyDashboardPageData.
  const { kpis, recentConversations } = await getAgencyDashboardPageData(tenantId, 6);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.dashboard.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">{t.dashboard.subtitle}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard label={t.dashboard.kpiNewMessages} value={kpis.newMessagesToday.toString()} icon={<MessageSquare className="h-3.5 w-3.5" />} highlight />
        <KpiCard label={t.dashboard.kpiQualifiedLeads} value={kpis.qualifiedLeads.toString()} icon={<Flame className="h-3.5 w-3.5" />} />
        <KpiCard label={t.dashboard.kpiPendingApprovals} value={kpis.pendingApprovals.toString()} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
        <KpiCard label={t.dashboard.kpiUpcomingMeetings} value={kpis.upcomingMeetings.toString()} icon={<CalendarClock className="h-3.5 w-3.5" />} />
        <KpiCard label={t.dashboard.kpiTotalClients} value={kpis.totalClients.toString()} icon={<Users className="h-3.5 w-3.5" />} />
      </div>

      {kpis.pendingApprovals > 0 && (
        <Card padding="md" className="border-[color-mix(in_oklab,var(--status-warm)_35%,transparent)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--text-1)]">
                {kpis.pendingApprovals} {kpis.pendingApprovals === 1 ? t.dashboard.approvalBannerSingle : t.dashboard.approvalBannerPlural}
              </p>
              <p className="text-xs text-[var(--text-4)] mt-0.5">
                {t.dashboard.approvalBannerSubtitle}
              </p>
            </div>
            <Link href="/agency/approvals" className="text-xs font-medium text-[var(--accent-from)] whitespace-nowrap">
              {t.dashboard.reviewNow}
            </Link>
          </div>
        </Card>
      )}

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>{t.dashboard.recentConversations}</CardTitle>
            <CardDescription>{t.dashboard.recentConversationsSubtitle}</CardDescription>
          </div>
        </CardHeader>
        <div className="divide-y divide-[var(--border-hairline)]">
          {recentConversations.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--text-4)]">{t.dashboard.noConversations}</p>
          )}
          {recentConversations.map((c) => (
            <Link
              key={c.id}
              href={`/agency/inbox?conversation=${c.id}`}
              className="flex items-center gap-3 py-3 hover:bg-[var(--surface-2)] -mx-2 px-2 rounded-lg transition-colors"
            >
              <Avatar name={c.nexarisClient.name ?? "?"} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-[var(--text-1)]">
                    {c.nexarisClient.name ?? c.nexarisClient.phone ?? t.dashboard.unknown}
                  </p>
                  <Badge variant="outline">{t.channel[c.channel.provider as keyof typeof t.channel] ?? c.channel.provider}</Badge>
                </div>
                <p className="truncate text-xs text-[var(--text-4)]">{c.messages[0]?.body ?? "—"}</p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <Badge variant="accent">{t.stage[c.stage as keyof typeof t.stage] ?? c.stage.replace(/_/g, " ")}</Badge>
                <span className="text-[10px] text-[var(--text-5)]">{timeAgo(c.lastMessageAt.toISOString())}</span>
              </div>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
