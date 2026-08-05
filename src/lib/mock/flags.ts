import { db } from "@/lib/db";

export async function getFeatureFlagsMatrix() {
  const [flags, products, tenants, plans] = await Promise.all([
    db.featureFlag.findMany({ orderBy: { key: "asc" } }),
    db.product.findMany(),
    db.tenant.findMany(),
    db.plan.findMany(),
  ]);

  const productMap = new Map(products.map((p) => [p.id, p.name]));
  const tenantMap = new Map(tenants.map((t) => [t.id, t.companyName]));
  const planMap = new Map(plans.map((p) => [p.id, p.name]));

  const enriched = flags.map((f) => {
    let scopeLabel = "Global";
    if (f.scope === "PRODUCT" && f.scopeId) scopeLabel = productMap.get(f.scopeId) ?? "Unknown product";
    if (f.scope === "TENANT" && f.scopeId) scopeLabel = tenantMap.get(f.scopeId) ?? "Unknown tenant";
    if (f.scope === "SUBSCRIPTION" && f.scopeId) scopeLabel = planMap.get(f.scopeId) ?? "Unknown plan";
    return { ...f, scopeLabel };
  });

  return enriched;
}
