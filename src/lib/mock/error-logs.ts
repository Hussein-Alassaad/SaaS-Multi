import { db } from "@/lib/db";

export async function getErrorLogs() {
  return db.errorLog.findMany({
    include: { tenant: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
