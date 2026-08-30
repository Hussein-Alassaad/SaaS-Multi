import { withTenant } from "@/lib/db";
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

  const rows = await withTenant(tenantId, (tx) =>
    tx.outreachLead.findMany({
      where,
      select: clientsListSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  );

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

async function readClientsCounts(tx: Prisma.TransactionClient, tenantId: string) {
  const total = await tx.outreachLead.count({ where: { tenantId } });
  const numbersFound = await tx.outreachLead.count({
    where: { tenantId, whatsappFound: true, whatsappNumber: { not: null } },
  });
  return { total, numbersFound };
}

/** Head-only counts, independent of pagination -- mirrors Clients.jsx's `loadCounts`. */
export async function getClientsCounts(tenantId: string) {
  return withTenant(tenantId, (tx) => readClientsCounts(tx, tenantId));
}

/**
 * Clients page's first-page list + head counts in ONE tenant scope.
 *
 * Was Promise.all([getClientsList, getClientsCounts]) -- two concurrent
 * withTenant() calls, so two real Postgres transactions for one page load.
 * Same bug class as getPipelineBoard's 7 (see src/lib/outreach/leads.ts's
 * getPipelineBoard for the full writeup). getClientsList stays public and
 * single-scope: the client component calls it on its own for "load more"
 * pagination and for search/filter changes, which genuinely are independent
 * single requests that should each get their own transaction.
 */
export async function getClientsPageData(tenantId: string) {
  const { rows, counts } = await withTenant(tenantId, async (tx) => {
    const rows = await tx.outreachLead.findMany({
      where: { tenantId },
      select: clientsListSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: DEFAULT_PAGE_SIZE + 1,
    });
    const counts = await readClientsCounts(tx, tenantId);
    return { rows, counts };
  });

  const hasMore = rows.length > DEFAULT_PAGE_SIZE;
  const items = hasMore ? rows.slice(0, DEFAULT_PAGE_SIZE) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null, counts };
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

  const rows = await withTenant(tenantId, (tx) =>
    tx.outreachClientHistory.findMany({
      where,
      select: clientHistoryListSelect,
      orderBy: [{ analyzedAt: "desc" }, { id: "desc" }],
      take: pageSize + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
  );

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

  return withTenant(tenantId, (tx) =>
    tx.outreachClientHistory.findMany({
      where,
      orderBy: { analyzedAt: "desc" },
      take: CSV_EXPORT_LIMIT,
    })
  );
}

/**
 * Replies for one lead, plus a map of accountId -> label for display --
 * mirrors ClientHistory.jsx's `ReplyPanel`, lazy-loaded per row on first
 * expand rather than joined into the main list query.
 */
export async function getLeadReplies(tenantId: string, leadId: string) {
  return withTenant(tenantId, async (tx) => {
    const replies = await tx.outreachReply.findMany({
      where: { tenantId, leadId },
      orderBy: { repliedAt: "asc" },
    });

    const accountIds = [...new Set(replies.map((r) => r.accountId).filter((id): id is string => Boolean(id)))];
    const accountLabels: Record<string, string> = {};
    if (accountIds.length) {
      const accounts = await tx.outreachAccount.findMany({
        where: { id: { in: accountIds }, tenantId },
        select: { id: true, label: true },
      });
      for (const a of accounts) accountLabels[a.id] = a.label;
    }

    return { replies, accountLabels };
  });
}
