import { db } from "@/lib/db";
import { safeJsonParse } from "@/lib/utils";

export async function getIntegrations() {
  const integrations = await db.integration.findMany({ orderBy: { provider: "asc" } });
  return integrations.map((i) => ({ ...i, config: safeJsonParse<Record<string, unknown>>(i.config, {}) }));
}
