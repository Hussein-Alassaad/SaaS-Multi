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
