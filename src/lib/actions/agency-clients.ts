"use server";

import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { getNexarisClientsList, getClientConversationHistory } from "@/lib/agency/clients";

/** "Load more" for the Clients list page. */
export async function loadMoreClientsAction(cursor: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "clients", "view");
  if (!permCheck.ok) return permCheck;

  const { items, nextCursor } = await getNexarisClientsList(session.tenantId!, cursor);

  return {
    ok: true as const,
    nextCursor,
    clients: items.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      company: c.company,
      tag: c.tag,
      conversationCount: c.conversations.length,
      updatedAt: c.updatedAt.toISOString(),
    })),
  };
}

/** "Load more" for a single client's conversation history on the Client Detail page. */
export async function loadMoreClientHistoryAction(clientId: string, cursor: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "clients", "view");
  if (!permCheck.ok) return permCheck;

  const { items, nextCursor } = await getClientConversationHistory(session.tenantId!, clientId, cursor);

  return {
    ok: true as const,
    nextCursor,
    conversations: items.map((c) => ({
      id: c.id,
      stage: c.stage,
      status: c.status,
      language: c.language,
      createdAt: c.createdAt.toISOString(),
      channel: { provider: c.channel.provider },
      messages: c.messages.map((m) => ({
        id: m.id,
        sender: m.sender,
        body: m.body,
        language: m.language,
        status: m.status,
        createdAt: m.createdAt.toISOString(),
      })),
    })),
  };
}
