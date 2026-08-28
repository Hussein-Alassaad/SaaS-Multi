import { withPlatformAccess } from "@/lib/db";

export async function getAiOverview() {
  // Admin/platform scope: this page intentionally reports across every
  // tenant. Sequential rather than Promise.all -- one TransactionClient
  // cannot run concurrent queries.
  const { logs, budgets, tenants } = await withPlatformAccess(async (tx) => {
    const logs = await tx.aiUsageLog.findMany({
      include: { tenant: true, product: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const budgets = await tx.aiBudget.findMany();
    const tenants = await tx.tenant.findMany({ select: { id: true, companyName: true } });
    return { logs, budgets, tenants };
  });

  const totalCost = logs.reduce((s, l) => s + l.costCents, 0);
  const totalTokens = logs.reduce((s, l) => s + l.tokens, 0);
  const avgLatency = logs.length ? Math.round(logs.reduce((s, l) => s + l.responseTimeMs, 0) / logs.length) : 0;
  const successRate = logs.length ? (logs.filter((l) => l.success).length / logs.length) * 100 : 100;

  const tenantMap = new Map(tenants.map((t) => [t.id, t.companyName]));
  const globalBudget = budgets.find((b) => b.scope === "GLOBAL");
  const productBudgets = budgets.filter((b) => b.scope === "PRODUCT");
  const tenantBudgets = budgets
    .filter((b) => b.scope === "TENANT")
    .map((b) => ({ ...b, tenantName: b.scopeId ? tenantMap.get(b.scopeId) ?? "Unknown" : "Unknown" }));

  return { logs, totalCost, totalTokens, avgLatency, successRate, globalBudget, productBudgets, tenantBudgets };
}
