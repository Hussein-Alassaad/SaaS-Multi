import { getTenantSession } from "@/lib/auth";
import { getAnalyticsRawLeads } from "@/lib/outreach/analytics";
import { AnalyticsClient } from "./AnalyticsClient";

export default async function OutreachAnalyticsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const rows = await getAnalyticsRawLeads(tenantId);

  const leads = rows.map((l) => ({
    platform: l.platform,
    temperature: l.temperature,
    status: l.status,
    contactCount: l.contactCount,
    createdAt: l.createdAt.toISOString(),
  }));

  return <AnalyticsClient leads={leads} />;
}
