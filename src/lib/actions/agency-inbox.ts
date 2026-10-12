"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { processInboundMessage } from "@/lib/agency/inbound";
import { deliverMessage } from "@/lib/channels/dispatch";
import { revalidatePath } from "next/cache";
import type { ChannelProvider } from "@/lib/agency/channels";

/**
 * Simulated inbound message injection -- stands in for a real WhatsApp/
 * Instagram/Facebook webhook until those API integrations are wired up
 * (see plan notes: "simulate first"). Creates/reuses a Channel +
 * NexarisClient + Conversation, appends the customer Message, then runs
 * the AI stub to draft a reply (queued for approval or auto-sent depending
 * on AiSettings + sensitivity).
 */
export async function simulateInboundMessageAction(input: {
  provider: ChannelProvider;
  customerName: string;
  customerPhone?: string;
  body: string;
}) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "inbox", "create");
  if (!permCheck.ok) return permCheck;

  if (!input.body.trim()) return { ok: false as const, error: "Message body is required." };
  const tenantId = session.tenantId!;

  const channel = await withTenant(tenantId, (tx) =>
    tx.channel.upsert({
      where: { tenantId_provider: { tenantId, provider: input.provider } },
      update: {},
      create: { tenantId, provider: input.provider, status: "CONNECTED", connectedAt: new Date() },
    })
  );

  const result = await processInboundMessage({
    tenantId,
    channelId: channel.id,
    externalContactId: null,
    customerName: input.customerName,
    customerPhone: input.customerPhone ?? null,
    body: input.body,
  });
  if (result.duplicate) return { ok: false as const, error: "Duplicate message." };

  revalidateInboxPaths();
  return { ok: true as const, conversationId: result.conversationId };
}

function revalidateInboxPaths() {
  revalidatePath("/agency/inbox");
  revalidatePath("/agency/approvals");
  revalidatePath("/agency/pipeline");
  revalidatePath("/agency/meetings");
  revalidatePath("/agency");
}

export async function approveMessageAction(messageId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const message = await tx.message.findFirst({
      where: { id: messageId, conversation: { tenantId: session.tenantId! } },
      include: { conversation: true },
    });
    if (!message) return false;

    await tx.message.update({
      where: { id: messageId },
      data: { status: "APPROVED", approvedById: session.id, approvedAt: new Date() },
    });
    await tx.conversation.update({ where: { id: message.conversationId }, data: { status: "OPEN" } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Message not found." };

  const delivery = await deliverMessage(session.tenantId!, messageId);

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/inbox");

  return delivery.ok ? { ok: true as const } : { ok: false as const, error: `Approved, but not sent: ${delivery.error}` };
}

export async function editAndApproveMessageAction(messageId: string, newBody: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  if (!newBody.trim()) return { ok: false as const, error: "Message body is required." };

  const found = await withTenant(session.tenantId!, async (tx) => {
    const message = await tx.message.findFirst({
      where: { id: messageId, conversation: { tenantId: session.tenantId! } },
    });
    if (!message) return false;

    await tx.message.update({
      where: { id: messageId },
      data: { body: newBody, sender: "HUMAN", status: "APPROVED", approvedById: session.id, approvedAt: new Date() },
    });
    await tx.conversation.update({ where: { id: message.conversationId }, data: { status: "OPEN" } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Message not found." };

  const delivery = await deliverMessage(session.tenantId!, messageId);

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/inbox");

  return delivery.ok ? { ok: true as const } : { ok: false as const, error: `Approved, but not sent: ${delivery.error}` };
}

export async function rejectMessageAction(messageId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const message = await tx.message.findFirst({
      where: { id: messageId, conversation: { tenantId: session.tenantId! } },
    });
    if (!message) return false;

    await tx.message.update({ where: { id: messageId }, data: { status: "REJECTED" } });
    await tx.conversation.update({ where: { id: message.conversationId }, data: { status: "AWAITING_CUSTOMER" } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Message not found." };

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/inbox");

  return { ok: true as const };
}

export async function updateConversationStageAction(conversationId: string, stage: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "pipeline", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, tenantId: session.tenantId! },
    });
    if (!conversation) return false;

    await tx.conversation.update({ where: { id: conversationId }, data: { stage } });

    if (stage === "WON" || stage === "LOST") {
      await tx.nexarisClient.update({
        where: { id: conversation.nexarisClientId },
        data: { tag: stage === "WON" ? "CONVERTED" : "LOST" },
      });
    }
    return true;
  });
  if (!found) return { ok: false as const, error: "Conversation not found." };

  revalidatePath("/agency/pipeline");
  revalidatePath("/agency");

  return { ok: true as const };
}

export async function updateClientTagAction(clientId: string, tag: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "clients", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const client = await tx.nexarisClient.findFirst({ where: { id: clientId, tenantId: session.tenantId! } });
    if (!client) return false;
    await tx.nexarisClient.update({ where: { id: clientId }, data: { tag } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Client not found." };

  revalidatePath("/agency/clients");
  return { ok: true as const };
}

export async function updateClientNotesAction(clientId: string, notes: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "clients", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const client = await tx.nexarisClient.findFirst({ where: { id: clientId, tenantId: session.tenantId! } });
    if (!client) return false;
    await tx.nexarisClient.update({ where: { id: clientId }, data: { notes } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Client not found." };

  revalidatePath("/agency/clients");
  return { ok: true as const };
}

/**
 * A person types a reply in the chat. It is sent right away, and the AI stops
 * answering this conversation (aiPaused) until someone resumes it -- otherwise
 * the AI and the person would talk over each other.
 */
export async function sendHumanReplyAction(conversationId: string, body: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "inbox", "create");
  if (!permCheck.ok) return permCheck;
  if (!body.trim()) return { ok: false as const, error: "Message body is required." };
  const tenantId = session.tenantId!;

  const message = await withTenant(tenantId, async (tx) => {
    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, tenantId } });
    if (!conversation) return null;
    const created = await tx.message.create({
      data: {
        conversationId,
        sender: "HUMAN",
        body: body.trim(),
        language: conversation.language,
        status: "APPROVED",
        approvedById: session.id,
        approvedAt: new Date(),
      },
    });
    await tx.conversation.update({
      where: { id: conversationId },
      data: { aiPaused: true, status: "AWAITING_CUSTOMER", lastMessageAt: new Date() },
    });
    return created;
  });
  if (!message) return { ok: false as const, error: "Conversation not found." };

  const delivery = await deliverMessage(tenantId, message.id);
  revalidateInboxPaths();
  return delivery.ok ? { ok: true as const } : { ok: false as const, error: `Saved, but not sent: ${delivery.error}` };
}

export async function setConversationAiPausedAction(conversationId: string, paused: boolean) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "inbox", "create");
  if (!permCheck.ok) return permCheck;

  const updated = await withTenant(session.tenantId!, (tx) =>
    tx.conversation.updateMany({ where: { id: conversationId, tenantId: session.tenantId! }, data: { aiPaused: paused } })
  );
  if (updated.count === 0) return { ok: false as const, error: "Conversation not found." };

  revalidatePath("/agency/inbox");
  return { ok: true as const };
}
