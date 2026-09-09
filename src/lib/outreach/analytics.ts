import { withTenant } from "@/lib/db";

/**
 * Single unfiltered fetch of every field the Analytics page's client-side
 * derivation needs (range filtering, bucketing, KPI counts) -- matches the
 * original single-tenant app's `.select('platform, temperature, status,
 * contact_count, created_at')` exactly. Deliberately not query-per-range:
 * all filtering happens in AnalyticsClient's useMemo over this one payload,
 * which is fine at this data scale and keeps the derivation logic identical
 * to the original (see Analytics.jsx).
 */
// Hard safety ceiling, not a real filter -- found unbounded in the
// 2026-09-09 platform review. A single tenant's outreach agent sends a
// handful of messages/day per account, so no real tenant is anywhere close
// to this today; it exists purely so a future runaway/misconfigured tenant
// degrades into a (slightly) truncated analytics view instead of one
// unbounded query slowly getting more expensive forever. Raise it, don't
// remove it, if a real tenant's honest lead count ever approaches it.
const MAX_ANALYTICS_LEADS = 50_000;

export async function getAnalyticsRawLeads(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.outreachLead.findMany({
      where: { tenantId },
      select: {
        platform: true,
        temperature: true,
        status: true,
        contactCount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: MAX_ANALYTICS_LEADS,
    })
  );
}
