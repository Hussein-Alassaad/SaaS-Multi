import { withPlatformAccess } from "@/lib/db";

export async function getAuditLogs() {
  return withPlatformAccess((tx) =>
    tx.auditLog.findMany({
      include: { actor: true, tenant: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
  );
}
