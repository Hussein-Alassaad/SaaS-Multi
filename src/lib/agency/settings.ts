import { db } from "@/lib/db";

/** AiSettings is 1:1 with Tenant; create a default row on first access so pages never see null. */
export async function getAiSettings(tenantId: string) {
  const existing = await db.aiSettings.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return db.aiSettings.create({ data: { tenantId } });
}

export async function getAnalyticsSummary(tenantId: string) {
  const [totalConversations, totalMessages, customerMessages, aiMessages, wonCount, meetingBookedCount] =
    await Promise.all([
      db.conversation.count({ where: { tenantId } }),
      db.message.count({ where: { conversation: { tenantId } } }),
      db.message.count({ where: { conversation: { tenantId }, sender: "CUSTOMER" } }),
      db.message.count({ where: { conversation: { tenantId }, sender: "AI" } }),
      db.conversation.count({ where: { tenantId, stage: "WON" } }),
      db.conversation.count({
        where: { tenantId, stage: { in: ["MEETING_BOOKED", "WON", "LOST"] } },
      }),
    ]);

  const responseRate = customerMessages === 0 ? 0 : Math.round((aiMessages / customerMessages) * 100);
  const qualifiedCount = await db.conversation.count({
    where: { tenantId, stage: { in: ["INTERESTED", "MEETING_PENDING", "MEETING_BOOKED", "WON"] } },
  });
  const qualificationRate = totalConversations === 0 ? 0 : Math.round((qualifiedCount / totalConversations) * 100);
  const meetingConversionRate =
    qualifiedCount === 0 ? 0 : Math.round((meetingBookedCount / qualifiedCount) * 100);
  const wonRate = totalConversations === 0 ? 0 : Math.round((wonCount / totalConversations) * 100);

  const byChannel = await db.conversation.groupBy({
    by: ["channelId"],
    where: { tenantId },
    _count: { _all: true },
  });
  const channels = await db.channel.findMany({ where: { tenantId } });
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
