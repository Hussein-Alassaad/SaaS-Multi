import { getAnalyticsOverview } from "@/lib/mock/analytics";
import { getRevenueGrowthSeries, getTenantGrowthSeries } from "@/lib/mock/dashboard";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { RevenueChart } from "@/components/charts/RevenueChart";
import { TenantGrowthChart } from "@/components/charts/TenantGrowthChart";
import { PlanDistributionChart } from "@/components/charts/PlanDistributionChart";
import { formatCents } from "@/lib/utils";
import { TrendingUp, Calendar, UserMinus, Heart, Wallet } from "lucide-react";

export default async function AnalyticsPage() {
  const [analytics, revenue, tenantGrowth] = await Promise.all([
    getAnalyticsOverview(),
    getRevenueGrowthSeries(),
    getTenantGrowthSeries(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Analytics</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Revenue, retention, and lifetime value across the platform.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard label="MRR" value={formatCents(analytics.mrr)} icon={<TrendingUp className="h-3.5 w-3.5" />} highlight />
        <KpiCard label="ARR" value={formatCents(analytics.arr)} icon={<Calendar className="h-3.5 w-3.5" />} highlight />
        <KpiCard label="Churn Rate" value={`${analytics.churnRate.toFixed(1)}%`} icon={<UserMinus className="h-3.5 w-3.5" />} />
        <KpiCard label="Retention Rate" value={`${analytics.retentionRate.toFixed(1)}%`} icon={<Heart className="h-3.5 w-3.5" />} />
        <KpiCard label="Avg LTV" value={formatCents(analytics.avgLtv)} icon={<Wallet className="h-3.5 w-3.5" />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RevenueChart data={revenue} />
        <TenantGrowthChart data={tenantGrowth} />
        <PlanDistributionChart data={analytics.planDistribution} />

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Cohort Retention</CardTitle>
              <CardDescription>Tenants by signup month, retained vs. total</CardDescription>
            </div>
          </CardHeader>
          <div className="scroll-x-container">
            <table className="w-full min-w-[400px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border-hairline)] text-left text-xs text-[var(--text-4)]">
                  <th className="py-2">Cohort</th>
                  <th className="py-2">Tenants</th>
                  <th className="py-2">Retention</th>
                </tr>
              </thead>
              <tbody>
                {analytics.cohorts.map((c) => (
                  <tr key={c.month} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="py-2 text-[var(--text-2)]">{c.month}</td>
                    <td className="py-2 text-[var(--text-2)]">{c.total}</td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--surface-2)]">
                          <div
                            className="h-full bg-accent-gradient"
                            style={{ width: `${c.retentionPct}%` }}
                          />
                        </div>
                        <span className="text-xs text-[var(--text-3)]">{c.retentionPct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
