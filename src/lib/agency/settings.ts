import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { readChannelsWithDefaults } from "@/lib/agency/channels";

/** AiSettings is 1:1 with Tenant; create a default row on first access so pages never see null. */
export async function readAiSettings(tx: Prisma.TransactionClient, tenantId: string) {
  const existing = await tx.aiSettings.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return tx.aiSettings.create({ data: { tenantId } });
}

export async function getAiSettings(tenantId: string) {
  return withTenant(tenantId, (tx) => readAiSettings(tx, tenantId));
}

/**
 * AI Control page's four reads in ONE tenant scope.
 *
 * Was a Promise.all over getChannelsWithDefaults + getAiSettings + two raw
 * withTenant() counts -- four concurrent withTenant() calls, so four real
 * Postgres transactions for one page load. (An earlier pass wrapped just the
 * two counts together and left the Promise.all in place; that still left
 * three transactions racing.) Same bug class as getPipelineBoard's 7 -- see
 * src/lib/outreach/leads.ts's getPipelineBoard for the full writeup.
 */
export async function getAiControlPageData(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const channels = await readChannelsWithDefaults(tx, tenantId);
    const settings = await readAiSettings(tx, tenantId);
    const activeConversations = await tx.conversation.count({
      where: { tenantId, status: { in: ["OPEN", "PENDING_APPROVAL"] } },
    });
    const pendingApprovals = await tx.message.count({
      where: { status: "PENDING_APPROVAL", conversation: { tenantId } },
    });
    return { channels, settings, activeConversations, pendingApprovals };
  });
}

/**
 * The summary's queries + shaping against a caller-supplied transaction
 * client, so a caller that already holds a tenant scope (see
 * getAnalyticsPageData in ./dashboard) can fold this in rather than opening
 * a second concurrent transaction for it.
 */
export async function readAnalyticsSummary(tx: Prisma.TransactionClient, tenantId: string) {
  // Sequential rather than a Promise.all, since one TransactionClient cannot
  // run concurrent queries.
  const totalConversations = await tx.conversation.count({ where: { tenantId } });
  const totalMessages = await tx.message.count({ where: { conversation: { tenantId } } });
  const customerMessages = await tx.message.count({ where: { conversation: { tenantId }, sender: "CUSTOMER" } });
  const aiMessages = await tx.message.count({ where: { conversation: { tenantId }, sender: "AI" } });
  const wonCount = await tx.conversation.count({ where: { tenantId, stage: "WON" } });
  const meetingBookedCount = await tx.conversation.count({
    where: { tenantId, stage: { in: ["MEETING_BOOKED", "WON", "LOST"] } },
  });
  const qualifiedCount = await tx.conversation.count({
    where: { tenantId, stage: { in: ["INTERESTED", "MEETING_PENDING", "MEETING_BOOKED", "WON"] } },
  });
  const byChannel = await tx.conversation.groupBy({
    by: ["channelId"],
    where: { tenantId },
    _count: { _all: true },
  });
  const channels = await tx.channel.findMany({ where: { tenantId } });

  const responseRate = customerMessages === 0 ? 0 : Math.round((aiMessages / customerMessages) * 100);
  const qualificationRate = totalConversations === 0 ? 0 : Math.round((qualifiedCount / totalConversations) * 100);
  const meetingConversionRate =
    qualifiedCount === 0 ? 0 : Math.round((meetingBookedCount / qualifiedCount) * 100);
  const wonRate = totalConversations === 0 ? 0 : Math.round((wonCount / totalConversations) * 100);

  const channelBreakdown = byChannel.map((b) => ({
    provider: channels.find((c) => c.id === b.channelId)?.provider ?? "UNKNOWN",
    count: b._count._all,
  }));

  return {
    totalConversations,
    totalMessages,
    responseRate,
    qualificationRate,
    meetingConversionRate,
    wonRate,
    channelBreakdown,
  };
}

/** Standalone reader -- one tenant scope of its own, for callers that want only this. */
export async function getAnalyticsSummary(tenantId: string) {
  return withTenant(tenantId, (tx) => readAnalyticsSummary(tx, tenantId));
}
