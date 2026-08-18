import { db } from "@/lib/db";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

/**
 * Paginated (cursor on id, sorted by lastMessageAt desc) -- fetches one
 * extra row to know whether a next page exists without a separate count
 * query. Reuses the tenantId+lastMessageAt composite index.
 */
export async function getConversationsList(tenantId: string, cursor?: string, pageSize: number = DEFAULT_PAGE_SIZE) {
  const rows = await db.conversation.findMany({
    where: { tenantId },
    include: {
      channel: true,
      nexarisClient: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export async function getConversationDetail(tenantId: string, conversationId: string) {
  return db.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      channel: true,
      nexarisClient: true,
      messages: { orderBy: { createdAt: "asc" } },
      meetingRequests: { include: { slot: true }, orderBy: { createdAt: "desc" } },
    },
  });
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
  const rows = await db.conversation.findMany({
    where: { tenantId, stage },
    include: {
      channel: true,
      nexarisClient: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: PIPELINE_COLUMN_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > PIPELINE_COLUMN_PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PIPELINE_COLUMN_PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/** Initial board load: first page of every column, fetched in parallel. */
export async function getPipelineBoard(tenantId: string) {
  const columns = await Promise.all(PIPELINE_STAGES.map((stage) => getPipelineColumn(tenantId, stage)));
  return Object.fromEntries(PIPELINE_STAGES.map((stage, i) => [stage, columns[i]])) as Record<
    PipelineStage,
    Awaited<ReturnType<typeof getPipelineColumn>>
  >;
}

export async function getPendingApprovals(tenantId: string) {
  return db.message.findMany({
    where: { status: "PENDING_APPROVAL", conversation: { tenantId } },
    include: {
      conversation: { include: { nexarisClient: true, channel: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}
