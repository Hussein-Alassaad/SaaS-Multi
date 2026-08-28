import { withTenant } from "@/lib/db";

export async function getTenantFeatureRequests(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.tenantFeatureRequest.findMany({
      where: { tenantId },
      include: { filedBy: true },
      orderBy: { createdAt: "desc" },
    })
  );
}
