import { getTenantSession } from "@/lib/auth";
import { getOutreachFeatureRequests } from "@/lib/outreach/feature-requests";
import { FeatureRequestsClient } from "./FeatureRequestsClient";

export default async function OutreachFeatureRequestsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const requests = await getOutreachFeatureRequests(tenantId);

  const rows = requests.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    filedByName: r.filedBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return <FeatureRequestsClient requests={rows} />;
}
