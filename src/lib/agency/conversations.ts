import { db } from "@/lib/db";

export async function getConversationsList(tenantId: string) {
  return db.conversation.findMany({
    where: { tenantId },
    include: {
      channel: true,
      nexarisClient: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
  });
}

export async function getConversationDetail(tenantId: string, conversationId: string) {
  return db.conversation.findFirst({
    where: { id: conversationId, tenantId },
    include: {
      channel: true,
      nexarisClient: true,
      messages: { orderBy: { createdAt: "asc" } },
      meetingRequests: { include: { slot: true }, orderBy: { createdAt: "desc" } },
    },
  });
}

export const PIPELINE_STAGES = [
  "NEW",
  "CONTACTED",
  "INTERESTED",
  "MEETING_PENDING",
  "MEETING_BOOKED",
  "WON",
  "LOST",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export async function getPipelineBoard(tenantId: string) {
  return db.conversation.findMany({
    where: { tenantId },
    include: {
      channel: true,
      nexarisClient: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { lastMessageAt: "desc" },
  });
}

export async function getPendingApprovals(tenantId: string) {
  return db.message.findMany({
    where: { status: "PENDING_APPROVAL", conversation: { tenantId } },
    include: {
      conversation: { include: { nexarisClient: true, channel: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}
