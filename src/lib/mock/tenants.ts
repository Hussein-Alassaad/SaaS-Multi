import { db } from "@/lib/db";
import { getTenantSectionToggles } from "@/lib/agency/sections";

export async function getTenantsList() {
  const tenants = await db.tenant.findMany({
    include: {
      product: true,
      owner: true,
      subscriptions: { include: { plan: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });
  return tenants;
}

export async function getTenantDetail(tenantId: string) {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    include: {
      product: true,
      owner: true,
      users: true,
      subscriptions: { include: { plan: true }, orderBy: { createdAt: "desc" } },
      invoices: { orderBy: { issuedAt: "desc" } },
      payments: { orderBy: { processedAt: "desc" }, include: { refunds: true } },
      aiUsageLogs: { orderBy: { createdAt: "desc" }, take: 50 },
      supportTickets: { orderBy: { createdAt: "desc" }, include: { assignee: true } },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 30, include: { actor: true } },
      impersonationSessions: { orderBy: { startedAt: "desc" }, include: { admin: true } },
      // Empty array for a non-Outreach tenant (e.g. marketing) -- harmless,
      // the admin UI only renders this tab when it finds rows here.
      outreachAccounts: { orderBy: { label: "asc" } },
    },
  });
  if (!tenant) return null;

  const flags = await db.featureFlag.findMany({
    where: { OR: [{ scope: "TENANT", scopeId: tenantId }, { scope: "GLOBAL" }] },
  });

  const sections = await getTenantSectionToggles(tenantId, tenant.product.slug);

  return { tenant, flags, sections };
}
