import { withPlatformAccess } from "@/lib/db";

export interface TenantOutreachPerformance {
  tenantId: string;
  companyName: string;
  totalLeads: number;
  contacted: number;
  replied: number;
  dealsClosed: number;
  replyRate: number;
  messageRate: number;
  dealRate: number;
}

/**
 * Cross-tenant Outreach performance, for the Admin dashboard's own rollup
 * view -- same three rates as the tenant-facing Analytics page
 * (AnalyticsClient.tsx: reply rate, message rate, deal rate), computed here
 * per tenant instead of per lead-list, so Admin can compare clients side by
 * side rather than opening each tenant's own Analytics page one at a time.
 *
 * Deal rate reuses the exact same signal the tenant-facing Pipeline board
 * already writes -- status="deal_closed" from a client dragging a lead
 * into that column (src/lib/outreach/pipeline-stages.ts) -- there is no
 * separate "admin collects this manually" step; a client marking a deal
 * closed on their own Pipeline is what feeds this rollup.
 *
 * Scoped to tenants that actually have at least one OutreachAccount --
 * matches list_active_tenant_ids()'s own definition of "an Outreach
 * tenant" on the Python agent side, so a Marketing-only tenant with zero
 * outreach activity never shows up here as a confusing all-zero row.
 */
export async function getOutreachPerformanceByTenant(): Promise<TenantOutreachPerformance[]> {
  const tenants = await withPlatformAccess((tx) =>
    tx.tenant.findMany({
      where: { outreachAccounts: { some: {} } },
      select: {
        id: true,
        companyName: true,
        outreachLeads: {
          select: { status: true, contactCount: true },
        },
      },
      orderBy: { companyName: "asc" },
    })
  );

  return tenants.map((t) => {
    const leads = t.outreachLeads;
    const totalLeads = leads.length;
    const contacted = leads.filter((l) => l.contactCount > 0 || l.status === "contacted").length;
    const replied = leads.filter((l) => l.status === "replied").length;
    const dealsClosed = leads.filter((l) => l.status === "deal_closed").length;

    return {
      tenantId: t.id,
      companyName: t.companyName,
      totalLeads,
      contacted,
      replied,
      dealsClosed,
      replyRate: contacted > 0 ? Math.round((replied / contacted) * 100) : 0,
      messageRate: totalLeads > 0 ? Math.round((contacted / totalLeads) * 100) : 0,
      dealRate: contacted > 0 ? Math.round((dealsClosed / contacted) * 100) : 0,
    };
  });
}
