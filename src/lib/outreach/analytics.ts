import { db } from "@/lib/db";

/**
 * Single unfiltered fetch of every field the Analytics page's client-side
 * derivation needs (range filtering, bucketing, KPI counts) -- matches the
 * original single-tenant app's `.select('platform, temperature, status,
 * contact_count, created_at')` exactly. Deliberately not query-per-range:
 * all filtering happens in AnalyticsClient's useMemo over this one payload,
 * which is fine at this data scale and keeps the derivation logic identical
 * to the original (see Analytics.jsx).
 */
export async function getAnalyticsRawLeads(tenantId: string) {
  return db.outreachLead.findMany({
    where: { tenantId },
    select: {
      platform: true,
      temperature: true,
      status: true,
      contactCount: true,
      createdAt: true,
    },
  });
}
