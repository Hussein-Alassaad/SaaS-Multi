import { withTenant } from "@/lib/db";

export const CHANNEL_PROVIDERS = ["WHATSAPP", "INSTAGRAM", "FACEBOOK", "GMAIL", "OUTLOOK"] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

// The two providers with a real OAuth connect/disconnect flow (see
// src/lib/agency/oauth-providers.ts) -- WHATSAPP/INSTAGRAM/FACEBOOK still
// use the simulated status-toggle in agency-integrations.ts's
// toggleChannelConnectionAction until Meta Business verification is done.
export const OAUTH_CHANNEL_PROVIDERS = ["GMAIL", "OUTLOOK"] as const;
export type OAuthChannelProvider = (typeof OAUTH_CHANNEL_PROVIDERS)[number];

export async function getChannels(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.channel.findMany({ where: { tenantId }, orderBy: { provider: "asc" } })
  );
}

/** Ensures a Channel row exists for every provider so the UI always has all 5 to show/connect. */
export async function getChannelsWithDefaults(tenantId: string) {
  const existing = await getChannels(tenantId);
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
