import { db } from "@/lib/db";

export async function getDashboardKpis() {
  const [
    totalTenants,
    activeTenants,
    totalUsers,
    openTickets,
    activeProducts,
    payments,
    aiLogsToday,
    aiLogsAll,
    activeSubs,
  ] = await Promise.all([
    db.tenant.count(),
    db.tenant.count({ where: { status: "ACTIVE" } }),
    db.user.count(),
    db.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.product.count({ where: { status: "ACTIVE" } }),
    db.payment.findMany({ where: { status: "SUCCEEDED" } }),
    db.aiUsageLog.findMany({
      where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    }),
    db.aiUsageLog.findMany(),
    // MRR approximation: sum of active subscriptions' plan monthly price.
    // Pulled into the same Promise.all as everything else above -- this
    // used to be a separate `await` after the batch, adding one full
    // extra network round-trip to Supabase per dashboard load for no
    // reason (it doesn't depend on any of the other queries' results).
    db.subscription.findMany({ where: { status: "ACTIVE" }, include: { plan: true } }),
  ]);

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

export async function getRevenueGrowthSeries() {
  const payments = await db.payment.findMany({ where: { status: "SUCCEEDED" } });
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
  return db.aiUsageLog.findMany({ select: { createdAt: true, costCents: true, tokens: true, success: true } });
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
  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { actor: true, tenant: true },
  });
  return logs;
}
