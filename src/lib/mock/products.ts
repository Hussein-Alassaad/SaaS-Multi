import { db } from "@/lib/db";
import { safeJsonParse } from "@/lib/utils";
import type { ProductConfig } from "@/types/product";

export async function getProductsList() {
  const products = await db.product.findMany({
    include: { tenants: true },
    orderBy: { createdAt: "asc" },
  });

  const withStats = await Promise.all(
    products.map(async (p) => {
      const tenantIds = p.tenants.map((t) => t.id);
      const [payments, aiLogs] = await Promise.all([
        db.payment.findMany({ where: { tenantId: { in: tenantIds }, status: "SUCCEEDED" } }),
        db.aiUsageLog.count({ where: { productId: p.id } }),
      ]);
      const revenue = payments.reduce((s, pay) => s + pay.amountCents, 0);
      return {
        ...p,
        config: safeJsonParse<ProductConfig>(p.config, {}),
        tenantCount: p.tenants.length,
        activeTenantCount: p.tenants.filter((t) => t.status === "ACTIVE").length,
        revenue,
        aiRequestCount: aiLogs,
      };
    })
  );

  return withStats;
}

export async function getProductBySlug(slug: string) {
  const product = await db.product.findUnique({
    where: { slug },
    include: {
      tenants: { include: { subscriptions: { include: { plan: true }, take: 1, orderBy: { createdAt: "desc" } } } },
    },
  });
  if (!product) return null;

  const tenantIds = product.tenants.map((t) => t.id);
  const [payments, aiLogs, flags, budget] = await Promise.all([
    db.payment.findMany({ where: { tenantId: { in: tenantIds }, status: "SUCCEEDED" } }),
    db.aiUsageLog.findMany({ where: { productId: product.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.featureFlag.findMany({ where: { scope: "PRODUCT", scopeId: product.id } }),
    db.aiBudget.findFirst({ where: { scope: "PRODUCT", scopeId: product.id } }),
  ]);

  const revenue = payments.reduce((s, p) => s + p.amountCents, 0);

  return {
    product: { ...product, config: safeJsonParse<ProductConfig>(product.config, {}) },
    revenue,
    aiLogs,
    flags,
    budget,
  };
}
