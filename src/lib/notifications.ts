import { db } from "@/lib/db";

/**
 * Every SENT notification a given tenant should see: ALL_TENANTS
 * (unconditional), PRODUCT_TENANTS scoped to this tenant's own product
 * (audienceRef = Product.id), or SPECIFIC_TENANT scoped to exactly this
 * tenant (audienceRef = Tenant.id). ALL_PLATFORM_USERS is deliberately
 * excluded -- that audience is Admin/platform staff, not tenants, and has
 * no tenant-facing display at all.
 */
export async function getTenantNotifications(tenantId: string, productId: string) {
  return db.notification.findMany({
    where: {
      status: "SENT",
      OR: [
        { audience: "ALL_TENANTS" },
        { audience: "PRODUCT_TENANTS", audienceRef: productId },
        { audience: "SPECIFIC_TENANT", audienceRef: tenantId },
      ],
    },
    orderBy: { sentAt: "desc" },
    take: 20,
  });
}
