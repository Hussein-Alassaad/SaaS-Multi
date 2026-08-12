import { getTenantFeatureRequests } from "@/lib/agency/feature-requests";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { FeatureRequestsClient } from "./FeatureRequestsClient";

export default async function FeatureRequestsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const requests = await getTenantFeatureRequests(tenantId);

  const rows = requests.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    status: r.status,
    filedByName: r.filedBy?.name ?? null,
    createdAt: r.createdAt.toISOString(),
  }));

  return <FeatureRequestsClient requests={rows} lang={lang} />;
}
