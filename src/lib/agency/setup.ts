/**
 * "Is this workspace ready for the AI to answer real customers?" -- the checklist shown on the agency dashboard.
 * Each item is computed from real data, so it ticks itself off as things get done.
 */

import { withTenant } from "@/lib/db";

export interface SetupItem {
  key: string;
  done: boolean;
  /** Where to go to fix it. */
  href: string;
  /** For the server-side item: which settings are missing (names only, never values). */
  missing?: string[];
}

const MIN_KNOWLEDGE_ENTRIES = 5;

/** Server settings the AI needs, set once on Vercel -- not per workspace. Names only are ever returned. */
function missingServerSettings(): string[] {
  const required = ["ANTHROPIC_API_KEY", "META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "APP_ENCRYPTION_KEY", "APP_URL", "CRON_SECRET"];
  return required.filter((name) => !process.env[name]);
}

export async function getSetupChecklist(tenantId: string): Promise<SetupItem[]> {
  const data = await withTenant(tenantId, async (tx) => {
    const localization = await tx.localizationSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
    const knowledge = await tx.knowledgeEntry.count({ where: { tenantId } });
    const settings = await tx.aiSettings.findUnique({ where: { tenantId }, select: { meetingAutoSlots: true } });
    const openSlots = await tx.meetingSlot.count({ where: { tenantId, status: "AVAILABLE", startsAt: { gte: new Date() } } });
    const connected = await tx.channel.count({ where: { tenantId, status: "CONNECTED", externalId: { not: null }, apiToken: { not: null } } });
    const realChats = await tx.conversation.count({ where: { tenantId, externalContactId: { not: null } } });
    return { localization, knowledge, settings, openSlots, connected, realChats };
  });

  const missing = missingServerSettings();
  return [
    // "UTC" is the form's default, i.e. nobody has chosen yet; times quoted to customers would be wrong for Lebanon.
    { key: "timezone", done: !!data.localization && data.localization.timezone !== "UTC", href: "/agency/settings" },
    { key: "knowledge", done: data.knowledge >= MIN_KNOWLEDGE_ENTRIES, href: "/agency/knowledge-base" },
    { key: "hours", done: !!data.settings?.meetingAutoSlots || data.openSlots > 0, href: "/agency/meetings" },
    { key: "server", done: missing.length === 0, href: "/agency/integrations", missing },
    { key: "channel", done: data.connected > 0, href: "/agency/integrations" },
    { key: "firstChat", done: data.realChats > 0, href: "/agency/inbox" },
  ];
}

export { MIN_KNOWLEDGE_ENTRIES };
