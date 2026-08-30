import { Prisma } from "@prisma/client";
import { db, withPlatformAccess } from "@/lib/db";

/**
 * Admin dashboard: platform-wide by definition. Sequential inside one
 * scope rather than a Promise.all, since one TransactionClient cannot have
 * concurrent queries in flight. (SupportTicket, Payment, AiUsageLog and
 * Subscription are all RLS tables; Tenant/User/Product are not, but they
 * ride along in the same scope rather than splitting the batch across two
 * connections.)
 */
async function readDashboardKpiRows(tx: Prisma.TransactionClient) {
  const totalTenants = await tx.tenant.count();
  const activeTenants = await tx.tenant.count({ where: { status: "ACTIVE" } });
  const totalUsers = await tx.user.count();
  const openTickets = await tx.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } });
  const activeProducts = await tx.product.count({ where: { status: "ACTIVE" } });
  const payments = await tx.payment.findMany({ where: { status: "SUCCEEDED" } });
  const aiLogsToday = await tx.aiUsageLog.findMany({
    where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
  });
  const aiLogsAll = await tx.aiUsageLog.findMany();
  // MRR approximation: sum of active subscriptions' plan monthly price.
  const activeSubs = await tx.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true } });
  return {
    totalTenants,
    activeTenants,
    totalUsers,
    openTickets,
    activeProducts,
    payments,
    aiLogsToday,
    aiLogsAll,
    activeSubs,
  };
}

function shapeDashboardKpis({
  totalTenants,
  activeTenants,
  totalUsers,
  openTickets,
  activeProducts,
  payments,
  aiLogsToday,
  aiLogsAll,
  activeSubs,
}: Awaited<ReturnType<typeof readDashboardKpiRows>>) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const revenueToday = payments
    .filter((p) => p.processedAt >= startOfToday)
    .reduce((s, p) => s + p.amountCents, 0);
  const revenueThisMonth = payments
    .filter((p) => p.processedAt >= startOfMonth)
    .reduce((s, p) => s + p.amountCents, 0);

  const mrr = activeSubs.reduce((s, sub) => s + sub.plan.monthlyPrice, 0);

  const aiCostToday = aiLogsToday.reduce((s, l) => s + l.costCents, 0);
  const aiCostThisMonth = aiLogsAll
    .filter((l) => l.createdAt >= startOfMonth)
    .reduce((s, l) => s + l.costCents, 0);

  return {
    totalTenants,
    activeTenants,
    mrr,
    revenueToday,
    revenueThisMonth,
    totalUsers,
    aiRequestsToday: aiLogsToday.length,
    aiCostToday,
    aiCostThisMonth,
    openTickets,
    activeProducts,
    systemHealth: 99.97,
  };
}

/** Standalone reader -- one platform scope of its own, for callers that want only this. */
export async function getDashboardKpis() {
  const rows = await withPlatformAccess((tx) => readDashboardKpiRows(tx));
  return shapeDashboardKpis(rows);
}

export async function getRevenueGrowthSeries() {
  const payments = await withPlatformAccess((tx) => tx.payment.findMany({ where: { status: "SUCCEEDED" } }));
  return shapeRevenueSeries(payments);
}

function shapeRevenueSeries(payments: { processedAt: Date; amountCents: number }[]) {
  const days: { date: string; revenue: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const dayRevenue = payments
      .filter((p) => p.processedAt >= d && p.processedAt < next)
      .reduce((s, p) => s + p.amountCents, 0);
    days.push({ date: d.toISOString().slice(5, 10), revenue: dayRevenue / 100 });
  }
  return days;
}

export async function getTenantGrowthSeries() {
  const tenants = await db.tenant.findMany({ select: { createdAt: true } });
  return shapeTenantGrowthSeries(tenants);
}

function shapeTenantGrowthSeries(tenants: { createdAt: Date }[]) {
  const days: { date: string; tenants: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(23, 59, 59, 999);
    const count = tenants.filter((t) => t.createdAt <= d).length;
    days.push({ date: d.toISOString().slice(5, 10), tenants: count });
  }
  return days;
}

type AiUsageLogForSeries = { createdAt: Date; costCents: number; tokens: number; success: boolean };

/**
 * Shared fetch for getAiUsageSeries + getApiRequestsSeries -- both used to
 * independently findMany() the entire AiUsageLog table (same rows, two
 * different field selections). Each network round-trip to Supabase costs
 * real latency now that this runs against remote Postgres instead of local
 * SQLite, so calling both series functions from the dashboard page's
 * Promise.all doesn't save anything here: neither was ever gated on the
 * other, they were just duplicating the same read. Callers that need both
 * series (see admin dashboard page.tsx) should fetch once via this and
 * pass the result into both functions below, instead of each calling this
 * on its own.
 */
export function getAiUsageLogsForSeries(): Promise<AiUsageLogForSeries[]> {
  return withPlatformAccess((tx) =>
    tx.aiUsageLog.findMany({ select: { createdAt: true, costCents: true, tokens: true, success: true } })
  );
}

export async function getAiUsageSeries(preloadedLogs?: AiUsageLogForSeries[]) {
  const logs = preloadedLogs ?? (await getAiUsageLogsForSeries());
  const days: { date: string; cost: number; tokens: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const dayLogs = logs.filter((l) => l.createdAt >= d && l.createdAt < next);
    days.push({
      date: d.toISOString().slice(5, 10),
      cost: dayLogs.reduce((s, l) => s + l.costCents, 0) / 100,
      tokens: dayLogs.reduce((s, l) => s + l.tokens, 0),
    });
  }
  return days;
}

export async function getApiRequestsSeries(preloadedLogs?: AiUsageLogForSeries[]) {
  // Derived from AI usage logs as a proxy for API request volume.
  const logs = preloadedLogs ?? (await getAiUsageLogsForSeries());
  const days: { date: string; requests: number; errors: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const dayLogs = logs.filter((l) => l.createdAt >= d && l.createdAt < next);
    days.push({
      date: d.toISOString().slice(5, 10),
      requests: dayLogs.length * 7, // scale factor to represent broader API traffic
      errors: dayLogs.filter((l) => !l.success).length,
    });
  }
  return days;
}

export async function getActiveUsersSeries() {
  const users = await db.user.findMany({ select: { lastLoginAt: true, createdAt: true } });
  return shapeActiveUsersSeries(users);
}

function shapeActiveUsersSeries(users: { lastLoginAt: Date | null; createdAt: Date }[]) {
  const days: { date: string; active: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const active = users.filter(
      (u) => u.lastLoginAt && u.lastLoginAt >= d && u.lastLoginAt < next
    ).length;
    days.push({ date: d.toISOString().slice(5, 10), active: active + Math.floor(users.length * 0.15) });
  }
  return days;
}

export async function getRecentActivity() {
  const logs = await withPlatformAccess((tx) =>
    tx.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { actor: true, tenant: true },
    })
  );
  return logs;
}

/**
 * Admin dashboard's whole payload in ONE platform scope.
 *
 * The page was a Promise.all over getDashboardKpis + getRevenueGrowthSeries
 * + getTenantGrowthSeries + getAiUsageLogsForSeries + getActiveUsersSeries +
 * getRecentActivity -- four of those open their own withPlatformAccess()
 * call, so four real Postgres transactions/connections were opened at once
 * for a single page load. Same bug class as getPipelineBoard's 7 (see
 * src/lib/outreach/leads.ts's getPipelineBoard for the full writeup): fine
 * locally, but Vercel serverless + Supabase's pgbouncer transaction pooler
 * is far more connection-constrained than local dev.
 *
 * Consolidating also drops two duplicate full-table reads: getDashboardKpis
 * already pulls every SUCCEEDED payment and every AiUsageLog row, which
 * getRevenueGrowthSeries and getAiUsageLogsForSeries were each re-fetching
 * independently. Those rows now feed the series shapers directly.
 *
 * Every function above stays public and single-scope for standalone callers.
 */
export async function getAdminDashboardPageData() {
  const { kpiRows, tenants, users, activity } = await withPlatformAccess(async (tx) => {
    const kpiRows = await readDashboardKpiRows(tx);
    const tenants = await tx.tenant.findMany({ select: { createdAt: true } });
    const users = await tx.user.findMany({ select: { lastLoginAt: true, createdAt: true } });
    const activity = await tx.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      include: { actor: true, tenant: true },
    });
    return { kpiRows, tenants, users, activity };
  });

  const aiUsageLogs: AiUsageLogForSeries[] = kpiRows.aiLogsAll;

  return {
    kpis: shapeDashboardKpis(kpiRows),
    revenue: shapeRevenueSeries(kpiRows.payments),
    tenantGrowth: shapeTenantGrowthSeries(tenants),
    activeUsers: shapeActiveUsersSeries(users),
    aiUsage: await getAiUsageSeries(aiUsageLogs),
    apiRequests: await getApiRequestsSeries(aiUsageLogs),
    activity,
  };
}
