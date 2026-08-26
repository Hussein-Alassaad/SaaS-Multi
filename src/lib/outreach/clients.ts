import { db } from "@/lib/db";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import type { Prisma } from "@prisma/client";

/**
 * Only the columns the Clients page's cards actually render -- select('*')
 * (or Prisma's implicit "all scalar fields") would pull every heavy column
 * (weak_points, ai_opportunities, generated_message, etc.) for every row on
 * every load, which is most of why the original Clients.jsx page got slow
 * as the leads table grew. Mirrors that file's `_LIST_COLUMNS` comment.
 */
const clientsListSelect = {
  id: true,
  businessName: true,
  platform: true,
  industry: true,
  score: true,
  temperature: true,
  status: true,
  founderFound: true,
  founderName: true,
  whatsappFound: true,
  whatsappNumber: true,
  contactCount: true,
  createdAt: true,
} satisfies Prisma.OutreachLeadSelect;

export async function getClientsList(
  tenantId: string,
  opts: { cursor?: string; pageSize?: number; search?: string; filter?: "all" | "numbers" } = {}
) {
  const { cursor, pageSize = DEFAULT_PAGE_SIZE, search, filter = "all" } = opts;

  const where: Prisma.OutreachLeadWhereInput = { tenantId };
  if (filter === "numbers") {
    where.whatsappFound = true;
    where.whatsappNumber = { not: null };
  }
  if (search?.trim()) {
    where.businessName = { contains: search.trim(), mode: "insensitive" };
  }

  const rows = await db.outreachLead.findMany({
    where,
    select: clientsListSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/** Head-only counts, independent of pagination -- mirrors Clients.jsx's `loadCounts`. */
export async function getClientsCounts(tenantId: string) {
  const [total, numbersFound] = await Promise.all([
    db.outreachLead.count({ where: { tenantId } }),
    db.outreachLead.count({ where: { tenantId, whatsappFound: true, whatsappNumber: { not: null } } }),
  ]);
  return { total, numbersFound };
}

/**
 * Only the columns the ClientHistory list rows actually render -- `snapshot`
 * (the heavy JSON column CSV export needs) is fetched separately, on demand,
 * via getClientHistoryExportRows. Mirrors ClientHistory.jsx's `_LIST_COLUMNS`.
 */
const clientHistoryListSelect = {
  id: true,
  leadId: true,
  businessName: true,
  contacted: true,
  temperature: true,
  platform: true,
  industry: true,
  score: true,
} satisfies Prisma.OutreachClientHistorySelect;

export async function getClientHistoryList(
  tenantId: string,
  opts: { cursor?: string; pageSize?: number; search?: string } = {}
) {
  const { cursor, pageSize = DEFAULT_PAGE_SIZE, search } = opts;

  const where: Prisma.OutreachClientHistoryWhereInput = { tenantId };
  if (search?.trim()) {
    where.businessName = { contains: search.trim(), mode: "insensitive" };
  }

  const rows = await db.outreachClientHistory.findMany({
    where,
    select: clientHistoryListSelect,
    orderBy: [{ analyzedAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

const CSV_EXPORT_LIMIT = 5000;

/**
 * Full rows (including `snapshot`) for CSV export, capped at 5,000 rows so a
 * huge export doesn't hang the request -- mirrors ClientHistory.jsx's
 * `handleExport`, which fetches this fresh rather than reusing loaded pages.
 */
export async function getClientHistoryExportRows(tenantId: string, search?: string) {
  const where: Prisma.OutreachClientHistoryWhereInput = { tenantId };
  if (search?.trim()) {
    where.businessName = { contains: search.trim(), mode: "insensitive" };
  }

  return db.outreachClientHistory.findMany({
    where,
    orderBy: { analyzedAt: "desc" },
    take: CSV_EXPORT_LIMIT,
  });
}

/**
 * Replies for one lead, plus a map of accountId -> label for display --
 * mirrors ClientHistory.jsx's `ReplyPanel`, lazy-loaded per row on first
 * expand rather than joined into the main list query.
 */
export async function getLeadReplies(tenantId: string, leadId: string) {
  const replies = await db.outreachReply.findMany({
    where: { tenantId, leadId },
    orderBy: { repliedAt: "asc" },
  });

  const accountIds = [...new Set(replies.map((r) => r.accountId).filter((id): id is string => Boolean(id)))];
  const accountLabels: Record<string, string> = {};
  if (accountIds.length) {
    const accounts = await db.outreachAccount.findMany({
      where: { id: { in: accountIds }, tenantId },
      select: { id: true, label: true },
    });
    for (const a of accounts) accountLabels[a.id] = a.label;
  }

  return { replies, accountLabels };
}
