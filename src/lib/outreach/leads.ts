import { withTenant } from "@/lib/db";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/outreach/pipeline-stages";

// Re-exported for existing server-side importers (page.tsx files) that
// already import PIPELINE_STAGES/PipelineStage from here -- only
// PipelineClient.tsx ("use client") was switched to import directly from
// pipeline-stages.ts instead, since a client component can't safely
// import this file (see pipeline-stages.ts's own docstring for why).
export { PIPELINE_STAGES, type PipelineStage };

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

/**
 * Was 7 concurrent withTenant() calls (Promise.all over getPipelineColumn
 * x6 + getPipelineStageCounts) -- each one its own real Postgres
 * transaction/connection, all opened at once for a single page load.
 * Harmless locally, but the Pipeline page crashed in production (Vercel
 * serverless + Supabase's pgbouncer transaction pooler is far more
 * connection-constrained than local dev) -- confirmed by reproducing the
 * same 7-transaction-at-once shape being the one real difference between
 * this page and every other working page in the app, all of which use a
 * single sequential withTenant(). Now one scope, one transaction, six
 * column queries plus six counts run sequentially against the same `tx`.
 */
export async function getPipelineBoard(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const leadsByStage = {} as Record<PipelineStage, { id: string; businessName: string | null; platform: string; score: number | null; temperature: string | null; status: string }[]>;
    const counts = {} as Record<PipelineStage, number>;
    for (const stage of PIPELINE_STAGES) {
      leadsByStage[stage] = await tx.outreachLead.findMany({
        where: { tenantId, status: stage },
        select: { id: true, businessName: true, platform: true, score: true, temperature: true, status: true },
        orderBy: { updatedAt: "desc" },
        take: PIPELINE_COLUMN_PAGE_SIZE,
      });
      counts[stage] = await tx.outreachLead.count({ where: { tenantId, status: stage } });
    }
    return { leadsByStage, counts };
  });
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
