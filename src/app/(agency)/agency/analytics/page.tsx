import { MessageSquare, TrendingUp, CalendarCheck, Trophy } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getAnalyticsSummary } from "@/lib/agency/settings";
import { getPipelineStageBreakdown, getConversationVolumeSeries } from "@/lib/agency/dashboard";
import { getTenantSession } from "@/lib/auth";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { LeadStageChart } from "@/components/charts/LeadStageChart";
import { ClientGrowthChart } from "@/components/charts/ClientGrowthChart";

export default async function AnalyticsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";
  const t = getDictionary(lang);

  const [summary, stageBreakdown, volumeSeries] = await Promise.all([
    getAnalyticsSummary(tenantId),
    getPipelineStageBreakdown(tenantId),
    getConversationVolumeSeries(tenantId),
  ]);

  const growthSeries = volumeSeries.map((d) => ({ date: d.date, clients: d.conversations }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.analytics.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">{t.analytics.subtitle}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label={t.analytics.kpiTotalConversations} value={summary.totalConversations.toString()} icon={<MessageSquare className="h-3.5 w-3.5" />} />
        <KpiCard label={t.analytics.kpiQualificationRate} value={`${summary.qualificationRate}%`} icon={<TrendingUp className="h-3.5 w-3.5" />} highlight />
        <KpiCard label={t.analytics.kpiMeetingConversion} value={`${summary.meetingConversionRate}%`} icon={<CalendarCheck className="h-3.5 w-3.5" />} />
        <KpiCard label={t.analytics.kpiWonRate} value={`${summary.wonRate}%`} icon={<Trophy className="h-3.5 w-3.5" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LeadStageChart data={stageBreakdown} />
        <ClientGrowthChart data={growthSeries} />
      </div>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>{t.analytics.channelPerformance}</CardTitle>
            <CardDescription>{t.analytics.channelPerformanceSubtitle}</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-2">
          {summary.channelBreakdown.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-4)]">{t.analytics.noConversations}</p>
          ) : (
            summary.channelBreakdown.map((c) => (
              <div key={c.provider} className="flex items-center justify-between text-sm">
                <Badge variant="outline">{t.channel[c.provider as keyof typeof t.channel] ?? c.provider}</Badge>
                <span className="font-medium text-[var(--text-1)]">{c.count} {t.analytics.conversations}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
