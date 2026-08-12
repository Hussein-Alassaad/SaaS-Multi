"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";

export async function getConversationThreadAction(conversationId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "inbox", "view");
  if (!permCheck.ok) return permCheck;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, tenantId: session.tenantId! },
    include: {
      channel: true,
      nexarisClient: true,
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!conversation) return { ok: false as const, error: "Conversation not found." };

  return {
    ok: true as const,
    conversation: {
      id: conversation.id,
      stage: conversation.stage,
      status: conversation.status,
      language: conversation.language,
      channel: { provider: conversation.channel.provider },
      client: {
        id: conversation.nexarisClient.id,
        name: conversation.nexarisClient.name,
        phone: conversation.nexarisClient.phone,
      },
      messages: conversation.messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        body: m.body,
        language: m.language,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  };
}
