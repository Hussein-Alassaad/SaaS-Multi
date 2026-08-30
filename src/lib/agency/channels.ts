import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { CHANNEL_PROVIDERS, type ChannelProvider, OAUTH_CHANNEL_PROVIDERS, type OAuthChannelProvider } from "@/lib/agency/channel-providers";

// Re-exported for existing server-side importers -- only IntegrationsClient.tsx
// ("use client") was switched to import directly from channel-providers.ts
// instead, since a client component can't safely import this file (see
// channel-providers.ts's own docstring for why).
export { CHANNEL_PROVIDERS, type ChannelProvider, OAUTH_CHANNEL_PROVIDERS, type OAuthChannelProvider };

export async function getChannels(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.channel.findMany({ where: { tenantId }, orderBy: { provider: "asc" } })
  );
}

/**
 * Ensures a Channel row exists for every provider so the UI always has all 5
 * to show/connect. Takes a caller-supplied transaction client so a caller
 * already holding a tenant scope can fold this in rather than opening a
 * second concurrent transaction.
 */
export async function readChannelsWithDefaults(tx: Prisma.TransactionClient, tenantId: string) {
  const existing = await tx.channel.findMany({ where: { tenantId }, orderBy: { provider: "asc" } });
  return applyChannelDefaults(existing, tenantId);
}

/** Ensures a Channel row exists for every provider so the UI always has all 5 to show/connect. */
export async function getChannelsWithDefaults(tenantId: string) {
  const existing = await getChannels(tenantId);
  return applyChannelDefaults(existing, tenantId);
}

function applyChannelDefaults(existing: Awaited<ReturnType<typeof getChannels>>, tenantId: string) {
  const byProvider = new Map(existing.map((c) => [c.provider, c]));
  return CHANNEL_PROVIDERS.map(
    (provider) =>
      byProvider.get(provider) ?? {
        id: `unconnected-${provider}`,
        tenantId,
        provider,
        status: "DISCONNECTED" as const,
        displayName: null,
        config: "{}",
        connectedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        oauthEmail: null,
        oauthAccessToken: null,
        oauthRefreshToken: null,
        oauthExpiresAt: null,
      }
  );
}
