import { db } from "@/lib/db";

/**
 * Account Health (spec §7.8) -- list of every outreach account for a
 * tenant, ordered by label to match the original single-tenant app's
 * `.order('label')` query exactly.
 */
export async function getAccountsList(tenantId: string) {
  return db.outreachAccount.findMany({
    where: { tenantId },
    orderBy: { label: "asc" },
  });
}

/**
 * Cheapest possible signal for the nav-badge dot on Account Health --
 * whether ANY account for this tenant is currently "warned" or "paused".
 * Deliberately a count() not a full findMany(), since this runs on every
 * Outreach page load via the layout, not just on Account Health itself.
 */
export async function getUnhealthyAccountCount(tenantId: string): Promise<number> {
  return db.outreachAccount.count({ where: { tenantId, status: { in: ["warned", "paused"] } } });
}

export interface AccountReachStats {
  sentToday: number;
  sentThisWeek: number;
  repliedThisWeek: number;
}

/**
 * Per-account send/reply counts for the reach-tracking display ("X of Y
 * reached today") and the weekly rollup on Account Health. Derived from
 * OutreachMessage.sentAt (real sends only -- awaiting/failed messages don't
 * count) and OutreachReply.repliedAt, both already indexed by account/date.
 * "Today"/"this week" are in server-local time, matching how the daily
 * limits themselves reset (no per-tenant timezone stored for outreach yet).
 */
export async function getAccountReachStats(tenantId: string): Promise<Map<string, AccountReachStats>> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);

  const [sentRows, replyRows] = await Promise.all([
    db.outreachMessage.findMany({
      where: { tenantId, sendStatus: "sent", sentAt: { gte: weekStart }, sentViaAccountId: { not: null } },
      select: { sentViaAccountId: true, sentAt: true },
    }),
    db.outreachReply.findMany({
      where: { tenantId, repliedAt: { gte: weekStart }, accountId: { not: null } },
      select: { accountId: true, repliedAt: true },
    }),
  ]);

  const stats = new Map<string, AccountReachStats>();
  const get = (accountId: string) => {
    let s = stats.get(accountId);
    if (!s) {
      s = { sentToday: 0, sentThisWeek: 0, repliedThisWeek: 0 };
      stats.set(accountId, s);
    }
    return s;
  };

  for (const row of sentRows) {
    if (!row.sentViaAccountId || !row.sentAt) continue;
    const s = get(row.sentViaAccountId);
    s.sentThisWeek += 1;
    if (row.sentAt >= todayStart) s.sentToday += 1;
  }
  for (const row of replyRows) {
    if (!row.accountId) continue;
    get(row.accountId).repliedThisWeek += 1;
  }

  return stats;
}
