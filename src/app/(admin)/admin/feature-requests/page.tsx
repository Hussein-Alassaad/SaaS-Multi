import { getFeatureRequests } from "@/lib/mock/feature-requests";
import { FeatureRequestsClient } from "./FeatureRequestsClient";

export default async function FeatureRequestsPage() {
  const requests = await getFeatureRequests();

  const rows = requests.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    tenantName: r.tenant.companyName,
    filedByName: r.filedBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Feature Requests</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          What tenants are asking for — review and prioritize the roadmap.
        </p>
      </div>

      <FeatureRequestsClient requests={rows} />
    </div>
  );
}
