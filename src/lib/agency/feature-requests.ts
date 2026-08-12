import { db } from "@/lib/db";

export async function getTenantFeatureRequests(tenantId: string) {
  return db.tenantFeatureRequest.findMany({
    where: { tenantId },
    include: { filedBy: true },
    orderBy: { createdAt: "desc" },
  });
}
