import { db } from "@/lib/db";

export const KNOWLEDGE_CATEGORIES = ["SERVICES", "PRICING", "FAQ", "POLICY", "OTHER"] as const;

export async function getKnowledgeEntries(tenantId: string) {
  return db.knowledgeEntry.findMany({
    where: { tenantId },
    include: { addedBy: true },
    orderBy: { updatedAt: "desc" },
  });
}
