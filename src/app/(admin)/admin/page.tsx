import {
  Building2,
  Activity as ActivityIcon,
  DollarSign,
  Users,
  Sparkles,
  LifeBuoy,
  Boxes,
  HeartPulse,
  TrendingUp,
  Wallet,
  CircleDollarSign,
  Cpu,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { RevenueChart } from "@/components/charts/RevenueChart";
import { TenantGrowthChart } from "@/components/charts/TenantGrowthChart";
import { AiUsageChart } from "@/components/charts/AiUsageChart";
import { ApiRequestsChart } from "@/components/charts/ApiRequestsChart";
import { ActiveUsersChart } from "@/components/charts/ActiveUsersChart";
import { formatCents, timeAgo } from "@/lib/utils";
import { getAdminDashboardPageData } from "@/lib/mock/dashboard";

export default async function DashboardPage() {
  // One withPlatformAccess() scope for every read on this page, and the AI
  // usage logs / payments are each fetched once and shared between the
  // series that derive from them -- see getAdminDashboardPageData.
  const { kpis, revenue, tenantGrowth, activeUsers, activity, aiUsage, apiRequests } =
    await getAdminDashboardPageData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Dashboard</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Platform-wide overview across all products and tenants.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
        <KpiCard label="Total Tenants" value={kpis.totalTenants.toString()} icon={<Building2 className="h-3.5 w-3.5" />} />
        <KpiCard
          label="Active Tenants"
          value={kpis.activeTenants.toString()}
          icon={<ActivityIcon className="h-3.5 w-3.5" />}
          delta={{ value: `${Math.round((kpis.activeTenants / Math.max(kpis.totalTenants, 1)) * 100)}% of total`, positive: true }}
        />
        <KpiCard label="MRR" value={formatCents(kpis.mrr)} icon={<TrendingUp className="h-3.5 w-3.5" />} highlight />
        <KpiCard label="Revenue Today" value={formatCents(kpis.revenueToday)} icon={<DollarSign className="h-3.5 w-3.5" />} />
        <KpiCard label="Revenue This Month" value={formatCents(kpis.revenueThisMonth)} icon={<Wallet className="h-3.5 w-3.5" />} />
        <KpiCard label="Total Users" value={kpis.totalUsers.toString()} icon={<Users className="h-3.5 w-3.5" />} />
        <KpiCard label="AI Requests Today" value={kpis.aiRequestsToday.toString()} icon={<Sparkles className="h-3.5 w-3.5" />} />
        <KpiCard label="AI Cost Today" value={formatCents(kpis.aiCostToday)} icon={<CircleDollarSign className="h-3.5 w-3.5" />} />
        <KpiCard label="AI Cost This Month" value={formatCents(kpis.aiCostThisMonth)} icon={<Cpu className="h-3.5 w-3.5" />} />
        <KpiCard label="Open Support Tickets" value={kpis.openTickets.toString()} icon={<LifeBuoy className="h-3.5 w-3.5" />} />
        <KpiCard label="Active Products" value={kpis.activeProducts.toString()} icon={<Boxes className="h-3.5 w-3.5" />} />
        <KpiCard label="System Health" value={`${kpis.systemHealth}%`} icon={<HeartPulse className="h-3.5 w-3.5" />} highlight />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RevenueChart data={revenue} />
        <TenantGrowthChart data={tenantGrowth} />
        <AiUsageChart data={aiUsage} />
        <ApiRequestsChart data={apiRequests} />
        <div className="lg:col-span-2">
          <ActiveUsersChart data={activeUsers} />
        </div>
      </div>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest actions across the platform</CardDescription>
          </div>
        </CardHeader>
        <div className="divide-y divide-[var(--border-hairline)]">
          {activity.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--text-4)]">No recent activity.</p>
          )}
          {activity.map((log) => (
            <div key={log.id} className="flex items-center gap-3 py-3">
              <Avatar name={log.actor?.name ?? "System"} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--text-2)]">
                  <span className="font-medium text-[var(--text-1)]">{log.actor?.name ?? "System"}</span>{" "}
                  {log.action.replace(/_/g, " ").replace(/\./g, " ")}
                  {log.tenant && (
                    <>
                      {" "}
                      on <span className="text-[var(--text-1)]">{log.tenant.companyName}</span>
                    </>
                  )}
                </p>
              </div>
              <Badge variant="outline" className="shrink-0">
                {timeAgo(log.createdAt)}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
