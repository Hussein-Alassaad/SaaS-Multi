import { getTenantSession } from "@/lib/auth";
import { getClientHistoryList } from "@/lib/outreach/clients";
import { ClientHistoryClient } from "./ClientHistoryClient";

export default async function OutreachClientHistoryPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const { items, nextCursor } = await getClientHistoryList(tenantId);

  const rows = items.map((row) => ({
    id: row.id,
    leadId: row.leadId,
    businessName: row.businessName,
    contacted: row.contacted,
    temperature: row.temperature,
    platform: row.platform,
    industry: row.industry,
    score: row.score,
  }));

  return <ClientHistoryClient tenantId={tenantId} initialRows={rows} initialNextCursor={nextCursor} />;
}
