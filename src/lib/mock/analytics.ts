import { db } from "@/lib/db";

export async function getAnalyticsOverview() {
  const [subs, tenants, payments] = await Promise.all([
    db.subscription.findMany({ include: { plan: true, tenant: true } }),
    db.tenant.findMany(),
    db.payment.findMany({ where: { status: "SUCCEEDED" } }),
  ]);

  const activeSubs = subs.filter((s) => s.status === "ACTIVE");
  const mrr = activeSubs.reduce((s, sub) => s + sub.plan.monthlyPrice, 0);
  const arr = mrr * 12;

  const churned = tenants.filter((t) => t.status === "CHURNED").length;
  const churnRate = tenants.length ? (churned / tenants.length) * 100 : 0;
  const retentionRate = 100 - churnRate;

  const totalRevenue = payments.reduce((s, p) => s + p.amountCents, 0);
  const avgLtv = tenants.length ? totalRevenue / tenants.length : 0;

  // Plan distribution
  const planDistribution = Object.values(
    activeSubs.reduce<Record<string, { name: string; count: number }>>((acc, s) => {
      acc[s.plan.name] = acc[s.plan.name] ?? { name: s.plan.name, count: 0 };
      acc[s.plan.name].count += 1;
      return acc;
    }, {})
  );

  // Simple cohort: tenants grouped by signup month, with a naive "retained" flag
  const cohortMap = new Map<string, { total: number; retained: number }>();
  for (const t of tenants) {
    const key = `${t.createdAt.getFullYear()}-${String(t.createdAt.getMonth() + 1).padStart(2, "0")}`;
    const entry = cohortMap.get(key) ?? { total: 0, retained: 0 };
    entry.total += 1;
    if (t.status !== "CHURNED") entry.retained += 1;
    cohortMap.set(key, entry);
  }
  const cohorts = Array.from(cohortMap.entries())
    .map(([month, v]) => ({ month, total: v.total, retentionPct: Math.round((v.retained / v.total) * 100) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return { mrr, arr, churnRate, retentionRate, avgLtv, planDistribution, cohorts };
}
