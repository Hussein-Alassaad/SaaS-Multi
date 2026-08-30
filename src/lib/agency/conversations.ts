import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { readPendingMeetingApprovals } from "@/lib/agency/meetings";

/**
 * Paginated (cursor on id, sorted by lastMessageAt desc) -- fetches one
 * extra row to know whether a next page exists without a separate count
 * query. Reuses the tenantId+lastMessageAt composite index.
 */
export async function getConversationsList(tenantId: string, cursor?: string, pageSize: number = DEFAULT_PAGE_SIZE) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.conversation.findMany({
      where: { tenantId },
      include: {
        channel: true,
        nexarisClient: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  );

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function getConversationDetail(tenantId: string, conversationId: string) {
  return withTenant(tenantId, (tx) =>
    tx.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        channel: true,
        nexarisClient: true,
        messages: { orderBy: { createdAt: "asc" } },
        meetingRequests: { include: { slot: true }, orderBy: { createdAt: "desc" } },
      },
    })
  );
}

export const PIPELINE_STAGES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "MEETING_PENDING",
  "MEETING_BOOKED",
  "WON",
  "LOST",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

const PIPELINE_COLUMN_PAGE_SIZE = 25;

/**
 * One page of cards for a single pipeline column. Reuses the
 * tenantId+stage+lastMessageAt composite index. Called once per stage so
 * each column can be paginated ("show more") independently -- a global
 * Load More doesn't make sense for a drag-and-drop board where each column
 * needs its own visible set.
 */
export async function getPipelineColumn(tenantId: string, stage: PipelineStage, cursor?: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.conversation.findMany({
      where: { tenantId, stage },
      include: {
        channel: true,
        nexarisClient: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: PIPELINE_COLUMN_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  );

  const hasMore = rows.length > PIPELINE_COLUMN_PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PIPELINE_COLUMN_PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/**
 * Initial board load: first page of every column. Was 7 concurrent
 * withTenant() calls (one per stage, via Promise.all + getPipelineColumn)
 * -- each its own real Postgres transaction/connection opened at once for
 * a single page load. Harmless locally, but the same shape crashed
 * Outreach's own Pipeline board in production (see that module's
 * getPipelineBoard() for the full writeup) -- fixed here identically:
 * one scope, one transaction, all seven columns queried sequentially
 * against the same `tx`. getPipelineColumn() itself is untouched and
 * still used standalone for each column's own "show more" pagination,
 * which genuinely does need its own request/transaction.
 */
export async function getPipelineBoard(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const board = {} as Record<PipelineStage, { items: Awaited<ReturnType<typeof getPipelineColumn>>["items"]; nextCursor: string | null }>;
    for (const stage of PIPELINE_STAGES) {
      const rows = await tx.conversation.findMany({
        where: { tenantId, stage },
        include: {
          channel: true,
          nexarisClient: true,
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
        take: PIPELINE_COLUMN_PAGE_SIZE + 1,
      });
      const hasMore = rows.length > PIPELINE_COLUMN_PAGE_SIZE;
      const items = hasMore ? rows.slice(0, PIPELINE_COLUMN_PAGE_SIZE) : rows;
      board[stage] = { items, nextCursor: hasMore ? items[items.length - 1].id : null };
    }
    return board;
  });
}

function readPendingApprovals(tx: Prisma.TransactionClient, tenantId: string) {
  // Message has no tenantId of its own -- it is scoped through its parent
  // conversation, which IS an RLS table, so the relation filter below is
  // itself enforced by the join under this tenant context.
  return tx.message.findMany({
    where: { status: "PENDING_APPROVAL", conversation: { tenantId } },
    include: {
      conversation: { include: { nexarisClient: true, channel: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function getPendingApprovals(tenantId: string) {
  return withTenant(tenantId, (tx) => readPendingApprovals(tx, tenantId));
}

/**
 * Approvals page's two reads in ONE tenant scope.
 *
 * Was Promise.all([getPendingApprovals, getPendingMeetingApprovals]) -- two
 * concurrent withTenant() calls, so two real Postgres transactions for one
 * page load. Same bug class as getPipelineBoard's 7 above. Both readers stay
 * public and single-scope for callers that need only one.
 */
export async function getApprovalsPageData(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const pendingMessages = await readPendingApprovals(tx, tenantId);
    const pendingMeetings = await readPendingMeetingApprovals(tx, tenantId);
    return { pendingMessages, pendingMeetings };
  });
}
