import { getTenantSession } from "@/lib/auth";
import { getClientsList, getClientsCounts } from "@/lib/outreach/clients";
import { ClientsClient } from "./ClientsClient";

export default async function OutreachClientsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const [{ items, nextCursor }, counts] = await Promise.all([
    getClientsList(tenantId),
    getClientsCounts(tenantId),
  ]);

  const clients = items.map((lead) => ({
    id: lead.id,
    businessName: lead.businessName,
    platform: lead.platform,
    industry: lead.industry,
    score: lead.score,
    temperature: lead.temperature,
    status: lead.status,
    founderFound: lead.founderFound,
    founderName: lead.founderName,
    whatsappFound: lead.whatsappFound,
    whatsappNumber: lead.whatsappNumber,
    contactCount: lead.contactCount,
    createdAt: lead.createdAt.toISOString(),
  }));

  return (
    <ClientsClient
      tenantId={tenantId}
      initialClients={clients}
      initialNextCursor={nextCursor}
      initialCounts={counts}
    />
  );
}
