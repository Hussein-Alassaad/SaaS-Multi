import { db } from "@/lib/db";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

/**
 * Paginated (cursor on id, sorted by updatedAt desc). Reuses the
 * tenantId+updatedAt composite index.
 */
export async function getNexarisClientsList(tenantId: string, cursor?: string, pageSize: number = DEFAULT_PAGE_SIZE) {
  const rows = await db.nexarisClient.findMany({
    where: { tenantId },
    include: { conversations: { select: { id: true, stage: true } } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

const CLIENT_HISTORY_PAGE_SIZE = 15;

/**
 * Client detail without conversation history (fast, always small) --
 * history is fetched separately via getClientConversationHistory so the
 * detail page can paginate that list independently.
 */
export async function getNexarisClientDetail(tenantId: string, clientId: string) {
  const client = await db.nexarisClient.findFirst({
    where: { id: clientId, tenantId },
    include: {
      meetingRequests: { include: { slot: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!client) return null;

  const history = await getClientConversationHistory(tenantId, clientId);
  return { ...client, conversations: history.items, conversationsNextCursor: history.nextCursor };
}

/**
 * Paginated conversation history for a single client ("Load more" on the
 * Client Detail page). Cursor on id, sorted by createdAt desc.
 */
export async function getClientConversationHistory(
  tenantId: string,
  clientId: string,
  cursor?: string,
  pageSize: number = CLIENT_HISTORY_PAGE_SIZE
) {
  const rows = await db.conversation.findMany({
    where: { tenantId, nexarisClientId: clientId },
    include: { channel: true, messages: { orderBy: { createdAt: "asc" } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

export const CLIENT_TAGS = ["REPLIED", "INTERESTED", "NOT_RESPONDING", "LOST", "CONVERTED"] as const;
