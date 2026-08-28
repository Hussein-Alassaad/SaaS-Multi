import { withTenant } from "@/lib/db";

/** AiSettings is 1:1 with Tenant; create a default row on first access so pages never see null. */
export async function getAiSettings(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const existing = await tx.aiSettings.findUnique({ where: { tenantId } });
    if (existing) return existing;
    return tx.aiSettings.create({ data: { tenantId } });
  });
}

export async function getAnalyticsSummary(tenantId: string) {
  // One tenant scope for every count below -- sequential rather than the
  // previous Promise.all, since one TransactionClient cannot run concurrent
  // queries.
  const {
    totalConversations,
    totalMessages,
    customerMessages,
    aiMessages,
    wonCount,
    meetingBookedCount,
    qualifiedCount,
    byChannel,
    channels,
  } = await withTenant(tenantId, async (tx) => {
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
    return {
      totalConversations,
      totalMessages,
      customerMessages,
      aiMessages,
      wonCount,
      meetingBookedCount,
      qualifiedCount,
      byChannel,
      channels,
    };
  });

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
