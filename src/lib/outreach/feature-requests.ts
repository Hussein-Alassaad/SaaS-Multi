import { db } from "@/lib/db";

export async function getOutreachFeatureRequests(tenantId: string) {
  return db.tenantFeatureRequest.findMany({
    where: { tenantId },
    include: { filedBy: true },
    orderBy: { createdAt: "desc" },
  });
}
