import { withPlatformAccess } from "@/lib/db";

export async function getErrorLogs() {
  return withPlatformAccess((tx) =>
    tx.errorLog.findMany({
      include: { tenant: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
  );
}
