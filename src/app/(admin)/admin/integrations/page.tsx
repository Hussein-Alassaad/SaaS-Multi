import { getIntegrations } from "@/lib/mock/integrations";
import { IntegrationsClient } from "./IntegrationsClient";

export default async function IntegrationsPage() {
  const integrations = await getIntegrations();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Integrations</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Connect and configure external services used across the platform.
        </p>
      </div>

      <IntegrationsClient
        integrations={integrations.map((i) => {
          const cfg = i.config as Record<string, unknown>;
          const summary = Object.entries(cfg)
            .slice(0, 2)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ");
          return {
            id: i.id,
            provider: i.provider,
            name: i.name,
            enabled: i.enabled,
            lastSyncAt: i.lastSyncAt?.toISOString() ?? null,
            configSummary: summary,
          };
        })}
      />
    </div>
  );
}
