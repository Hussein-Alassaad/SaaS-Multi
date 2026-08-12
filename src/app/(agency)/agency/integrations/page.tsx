import { getChannelsWithDefaults } from "@/lib/agency/channels";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { IntegrationsClient } from "./IntegrationsClient";

export default async function IntegrationsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const channels = await getChannelsWithDefaults(tenantId);

  const rows = channels.map((c) => ({
    provider: c.provider,
    status: c.status,
    displayName: c.displayName,
    connectedAt: c.connectedAt ? c.connectedAt.toISOString() : null,
  }));

  return <IntegrationsClient channels={rows} lang={lang} />;
}
