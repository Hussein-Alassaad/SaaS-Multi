import { db } from "@/lib/db";

export async function getAuditLogs() {
  return db.auditLog.findMany({
    include: { actor: true, tenant: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
