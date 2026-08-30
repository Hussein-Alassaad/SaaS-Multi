import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { readAnalyticsSummary } from "@/lib/agency/settings";

const PIPELINE_STAGES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "MEETING_PENDING",
  "MEETING_BOOKED",
  "WON",
  "LOST",
] as const;

/**
 * The KPI queries + shaping against a caller-supplied transaction client, so
 * a caller that already holds a tenant scope can fold these in rather than
 * opening a second concurrent transaction.
 */
export async function readAgencyDashboardKpis(tx: Prisma.TransactionClient, tenantId: string) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Sequential -- one TransactionClient cannot run concurrent queries.
  const newMessagesToday = await tx.message.count({
    where: { sender: "CUSTOMER", createdAt: { gte: startOfDay }, conversation: { tenantId } },
  });
  const qualifiedLeads = await tx.conversation.count({
    where: { tenantId, stage: { in: ["INTERESTED", "MEETING_PENDING", "MEETING_BOOKED"] } },
  });
  const pendingApprovals = await tx.message.count({
    where: { status: "PENDING_APPROVAL", conversation: { tenantId } },
  });
  const upcomingMeetings = await tx.meetingRequest.count({
    where: { tenantId, status: "APPROVED", slot: { startsAt: { gte: now } } },
  });
  const totalClients = await tx.nexarisClient.count({ where: { tenantId } });
  const conversationsByStage = await tx.conversation.findMany({ where: { tenantId }, select: { stage: true } });

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

/** Standalone reader -- one tenant scope of its own, for callers that want only this. */
export async function getAgencyDashboardKpis(tenantId: string) {
  return withTenant(tenantId, (tx) => readAgencyDashboardKpis(tx, tenantId));
}

/** Pure shaping of already-fetched rows -- shared by the standalone and batched readers below. */
function shapeStageBreakdown(conversations: { stage: string }[]) {
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    count: conversations.filter((c) => c.stage === stage).length,
  }));
}

function shapeVolumeSeries(conversations: { createdAt: Date }[]) {
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

export async function getPipelineStageBreakdown(tenantId: string) {
  const conversations = await withTenant(tenantId, (tx) =>
    tx.conversation.findMany({ where: { tenantId }, select: { stage: true } })
  );
  return shapeStageBreakdown(conversations);
}

export async function getConversationVolumeSeries(tenantId: string) {
  const conversations = await withTenant(tenantId, (tx) =>
    tx.conversation.findMany({
      where: { tenantId },
      select: { createdAt: true },
    })
  );
  return shapeVolumeSeries(conversations);
}

function readRecentConversations(tx: Prisma.TransactionClient, tenantId: string, limit = 5) {
  return tx.conversation.findMany({
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

/** Standalone reader -- one tenant scope of its own, for callers that want only this. */
export async function getRecentConversations(tenantId: string, limit = 5) {
  return withTenant(tenantId, (tx) => readRecentConversations(tx, tenantId, limit));
}

/**
 * Analytics page's three reads in ONE tenant scope.
 *
 * Was a Promise.all over getAnalyticsSummary + getPipelineStageBreakdown +
 * getConversationVolumeSeries -- three concurrent withTenant() calls, so
 * three real Postgres transactions/connections opened at once for a single
 * page load. Same bug class as getPipelineBoard's 7 (see
 * src/lib/outreach/leads.ts's getPipelineBoard for the full writeup): fine
 * locally, but Vercel serverless + Supabase's pgbouncer transaction pooler
 * is far more connection-constrained than local dev.
 *
 * The two breakdown readers also both scanned the whole conversation table
 * independently -- one shared findMany now feeds both shapers, so this is a
 * query fewer as well as two transactions fewer. The standalone
 * getPipelineStageBreakdown/getConversationVolumeSeries above stay as-is;
 * they are correct for any caller that genuinely needs just one of them.
 */
export async function getAnalyticsPageData(tenantId: string) {
  const { summary, conversations } = await withTenant(tenantId, async (tx) => {
    const summary = await readAnalyticsSummary(tx, tenantId);
    const conversations = await tx.conversation.findMany({
      where: { tenantId },
      select: { stage: true, createdAt: true },
    });
    return { summary, conversations };
  });

  return {
    summary,
    stageBreakdown: shapeStageBreakdown(conversations),
    volumeSeries: shapeVolumeSeries(conversations),
  };
}

/**
 * Dashboard page's two reads in ONE tenant scope.
 *
 * Was Promise.all([getAgencyDashboardKpis, getRecentConversations]) -- two
 * concurrent withTenant() calls, so two real Postgres transactions for one
 * page load. Same bug class as getPipelineBoard's 7 (see
 * src/lib/outreach/leads.ts's getPipelineBoard). Both readers stay public
 * and single-scope for standalone use.
 */
export async function getAgencyDashboardPageData(tenantId: string, recentLimit = 5) {
  const { kpis, recentConversations } = await withTenant(tenantId, async (tx) => {
    const kpis = await readAgencyDashboardKpis(tx, tenantId);
    const recentConversations = await readRecentConversations(tx, tenantId, recentLimit);
    return { kpis, recentConversations };
  });
  return { kpis, recentConversations };
}
