import { db } from "@/lib/db";

const PIPELINE_STAGES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "MEETING_PENDING",
  "MEETING_BOOKED",
  "WON",
  "LOST",
] as const;

export async function getAgencyDashboardKpis(tenantId: string) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    newMessagesToday,
    qualifiedLeads,
    pendingApprovals,
    upcomingMeetings,
    totalClients,
    conversationsByStage,
  ] = await Promise.all([
    db.message.count({
      where: { sender: "CUSTOMER", createdAt: { gte: startOfDay }, conversation: { tenantId } },
    }),
    db.conversation.count({
      where: { tenantId, stage: { in: ["INTERESTED", "MEETING_PENDING", "MEETING_BOOKED"] } },
    }),
    db.message.count({ where: { status: "PENDING_APPROVAL", conversation: { tenantId } } }),
    db.meetingRequest.count({
      where: { tenantId, status: "APPROVED", slot: { startsAt: { gte: now } } },
    }),
    db.nexarisClient.count({ where: { tenantId } }),
    db.conversation.findMany({ where: { tenantId }, select: { stage: true } }),
  ]);

  const stageBreakdown = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [stage, conversationsByStage.filter((c) => c.stage === stage).length])
  ) as Record<(typeof PIPELINE_STAGES)[number], number>;

  return {
    newMessagesToday,
    qualifiedLeads,
    pendingApprovals,
    upcomingMeetings,
    totalClients,
    stageBreakdown,
  };
}

export async function getPipelineStageBreakdown(tenantId: string) {
  const conversations = await db.conversation.findMany({ where: { tenantId }, select: { stage: true } });
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    count: conversations.filter((c) => c.stage === stage).length,
  }));
}

export async function getConversationVolumeSeries(tenantId: string) {
  const conversations = await db.conversation.findMany({
    where: { tenantId },
    select: { createdAt: true },
  });
  const days: { date: string; conversations: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    const count = conversations.filter((c) => c.createdAt >= dayStart && c.createdAt < dayEnd).length;
    days.push({ date: dayStart.toISOString().slice(5, 10), conversations: count });
  }
  return days;
}

export async function getRecentConversations(tenantId: string, limit = 5) {
  return db.conversation.findMany({
    where: { tenantId },
    include: {
      nexarisClient: true,
      channel: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
    take: limit,
  });
}
