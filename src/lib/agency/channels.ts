import { db } from "@/lib/db";

export const CHANNEL_PROVIDERS = ["WHATSAPP", "INSTAGRAM", "FACEBOOK"] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

export async function getChannels(tenantId: string) {
  return db.channel.findMany({ where: { tenantId }, orderBy: { provider: "asc" } });
}

/** Ensures a Channel row exists for every provider so the UI always has all 3 to show/connect. */
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
      }
  );
}
