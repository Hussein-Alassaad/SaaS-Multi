import { withTenant } from "@/lib/db";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

/**
 * Kanban stages for the Outreach Pipeline board -- matches the original
 * single-tenant app's board exactly (agent/crm/pipeline.py's STAGES).
 * Leads only enter the board once status moves past the discovery/approval
 * statuses (discovered/analyzed/awaiting_approval/approved/manual_send_pending) --
 * there is deliberately no "new"/discovery column here, matching the original.
 */
export const PIPELINE_STAGES = [
  "contacted",
  "replied",
  "interested",
  "meeting_booked",
  "deal_closed",
  "lost",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

const PIPELINE_COLUMN_PAGE_SIZE = 20;

const leadCardInclude = {
  account: true,
  messages: { orderBy: { createdAt: "desc" as const }, take: 1 },
} as const;

export async function getLiveFeed(tenantId: string, cursor?: string, pageSize: number = DEFAULT_PAGE_SIZE) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const rows = await withTenant(tenantId, (tx) =>
    tx.outreachLead.findMany({
      where: { tenantId, createdAt: { gte: todayStart } },
      include: leadCardInclude,
      orderBy: [{ score: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  );

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function getLeadDetail(tenantId: string, leadId: string) {
  return withTenant(tenantId, (tx) =>
    tx.outreachLead.findFirst({
      where: { id: leadId, tenantId },
      include: {
        account: true,
        messages: { orderBy: { createdAt: "asc" } },
        pipelineHistory: { orderBy: { changedAt: "asc" } },
        followUps: { orderBy: { createdAt: "desc" } },
        clientHistory: { orderBy: { analyzedAt: "desc" } },
        replies: { orderBy: { repliedAt: "desc" } },
      },
    })
  );
}

export async function getPipelineColumn(
  tenantId: string,
  stage: PipelineStage,
  limit: number = PIPELINE_COLUMN_PAGE_SIZE
) {
  return withTenant(tenantId, (tx) =>
    tx.outreachLead.findMany({
      where: { tenantId, status: stage },
      select: { id: true, businessName: true, platform: true, score: true, temperature: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    })
  );
}

export async function getPipelineStageCounts(tenantId: string) {
  // One scope for all six counts rather than six separate transactions.
  const counts = await withTenant(tenantId, async (tx) => {
    const out: number[] = [];
    for (const stage of PIPELINE_STAGES) {
      out.push(await tx.outreachLead.count({ where: { tenantId, status: stage } }));
    }
    return out;
  });
  return Object.fromEntries(PIPELINE_STAGES.map((stage, i) => [stage, counts[i]])) as Record<PipelineStage, number>;
}

export async function getPipelineBoard(tenantId: string) {
  const [columns, counts] = await Promise.all([
    Promise.all(PIPELINE_STAGES.map((stage) => getPipelineColumn(tenantId, stage))),
    getPipelineStageCounts(tenantId),
  ]);
  const leadsByStage = Object.fromEntries(PIPELINE_STAGES.map((stage, i) => [stage, columns[i]])) as Record<
    PipelineStage,
    Awaited<ReturnType<typeof getPipelineColumn>>
  >;
  return { leadsByStage, counts };
}

export async function getPendingApprovals(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.outreachMessage.findMany({
      where: { tenantId, approvalStatus: "awaiting" },
      include: { lead: { include: { account: true } } },
      orderBy: { createdAt: "asc" },
    })
  );
}
