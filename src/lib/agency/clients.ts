import { db } from "@/lib/db";

export async function getNexarisClientsList(tenantId: string) {
  return db.nexarisClient.findMany({
    where: { tenantId },
    include: { conversations: { select: { id: true, stage: true } } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function getNexarisClientDetail(tenantId: string, clientId: string) {
  return db.nexarisClient.findFirst({
    where: { id: clientId, tenantId },
    include: {
      conversations: {
        include: { channel: true, messages: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      },
      meetingRequests: { include: { slot: true }, orderBy: { createdAt: "desc" } },
    },
  });
}

export const CLIENT_TAGS = ["REPLIED", "INTERESTED", "NOT_RESPONDING", "LOST", "CONVERTED"] as const;
