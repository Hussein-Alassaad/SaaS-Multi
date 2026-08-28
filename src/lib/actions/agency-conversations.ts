"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { getConversationsList } from "@/lib/agency/conversations";

/** "Load more" for the Live Inbox conversation list. */
export async function loadMoreConversationsAction(cursor: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "inbox", "view");
  if (!permCheck.ok) return permCheck;

  const { items, nextCursor } = await getConversationsList(session.tenantId!, cursor);

  return {
    ok: true as const,
    nextCursor,
    conversations: items.map((c) => ({
      id: c.id,
      stage: c.stage,
      status: c.status,
      language: c.language,
      lastMessageAt: c.lastMessageAt.toISOString(),
      channel: { provider: c.channel.provider },
      client: { id: c.nexarisClient.id, name: c.nexarisClient.name, phone: c.nexarisClient.phone },
      lastMessage: c.messages[0]
        ? { body: c.messages[0].body, sender: c.messages[0].sender, status: c.messages[0].status }
        : null,
    })),
  };
}

export async function getConversationThreadAction(conversationId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "inbox", "view");
  if (!permCheck.ok) return permCheck;

  const conversation = await withTenant(session.tenantId!, (tx) =>
    tx.conversation.findFirst({
      where: { id: conversationId, tenantId: session.tenantId! },
      include: {
        channel: true,
        nexarisClient: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    })
  );
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
