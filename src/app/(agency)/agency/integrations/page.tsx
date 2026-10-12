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
    // true only for a number connected through Meta (has real credentials), not the demo toggle
    isReal: !!c.externalId,
  }));

  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return (
    <IntegrationsClient
      channels={rows}
      lang={lang}
      webhookUrl={appUrl ? `${appUrl}/api/webhooks/whatsapp` : null}
      serverReady={!!process.env.META_APP_SECRET && !!process.env.WHATSAPP_VERIFY_TOKEN && !!process.env.APP_ENCRYPTION_KEY}
    />
  );
}
