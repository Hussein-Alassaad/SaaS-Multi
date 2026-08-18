"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { generateAiReply, detectLanguage } from "@/lib/ai/respond";
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

  const channel = await db.channel.upsert({
    where: { tenantId_provider: { tenantId, provider: input.provider } },
    update: {},
    create: { tenantId, provider: input.provider, status: "CONNECTED", connectedAt: new Date() },
  });

  let nexarisClient = input.customerPhone
    ? await db.nexarisClient.findFirst({ where: { tenantId, phone: input.customerPhone } })
    : null;
  if (!nexarisClient) {
    nexarisClient = await db.nexarisClient.create({
      data: { tenantId, name: input.customerName, phone: input.customerPhone },
    });
  }

  let conversation = await db.conversation.findFirst({
    where: { tenantId, channelId: channel.id, nexarisClientId: nexarisClient.id, status: { not: "CLOSED" } },
  });
  const language = detectLanguage(input.body);
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { tenantId, channelId: channel.id, nexarisClientId: nexarisClient.id, language },
    });
  }

  await db.message.create({
    data: { conversationId: conversation.id, sender: "CUSTOMER", body: input.body, language, status: "SENT" },
  });

  const settings = await db.aiSettings.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId },
  });
  const knowledgeEntries = await db.knowledgeEntry.findMany({ where: { tenantId }, take: 10 });

  const aiReply = await generateAiReply({
    customerMessage: input.body,
    language: settings.allowEnglish ? language : "AR",
    clientName: nexarisClient.name,
    knowledgeEntries: knowledgeEntries.map((k) => ({ title: k.title, body: k.body })),
    settings,
    tenantId,
    conversationId: conversation.id,
  });

  await db.message.create({
    data: {
      conversationId: conversation.id,
      sender: "AI",
      body: aiReply.body,
      language: aiReply.language,
      status: aiReply.requiresApproval ? "PENDING_APPROVAL" : "SENT",
    },
  });

  const nextStage = conversation.stage === "NEW" ? "CONTACTED" : conversation.stage;
  await db.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessageAt: new Date(),
      stage: nextStage,
      status: aiReply.requiresApproval ? "PENDING_APPROVAL" : "OPEN",
    },
  });

  revalidatePath("/agency/inbox");
  revalidatePath("/agency/approvals");
  revalidatePath("/agency/pipeline");
  revalidatePath("/agency");

  return { ok: true as const, conversationId: conversation.id };
}

export async function approveMessageAction(messageId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const message = await db.message.findFirst({
    where: { id: messageId, conversation: { tenantId: session.tenantId! } },
    include: { conversation: true },
  });
  if (!message) return { ok: false as const, error: "Message not found." };

  await db.message.update({
    where: { id: messageId },
    data: { status: "APPROVED", approvedById: session.id, approvedAt: new Date() },
  });
  await db.conversation.update({ where: { id: message.conversationId }, data: { status: "OPEN" } });

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/inbox");

  return { ok: true as const };
}

export async function editAndApproveMessageAction(messageId: string, newBody: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  if (!newBody.trim()) return { ok: false as const, error: "Message body is required." };

  const message = await db.message.findFirst({
    where: { id: messageId, conversation: { tenantId: session.tenantId! } },
  });
  if (!message) return { ok: false as const, error: "Message not found." };

  await db.message.update({
    where: { id: messageId },
    data: { body: newBody, sender: "HUMAN", status: "APPROVED", approvedById: session.id, approvedAt: new Date() },
  });
  await db.conversation.update({ where: { id: message.conversationId }, data: { status: "OPEN" } });

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/inbox");

  return { ok: true as const };
}

export async function rejectMessageAction(messageId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const message = await db.message.findFirst({
    where: { id: messageId, conversation: { tenantId: session.tenantId! } },
  });
  if (!message) return { ok: false as const, error: "Message not found." };

  await db.message.update({ where: { id: messageId }, data: { status: "REJECTED" } });
  await db.conversation.update({ where: { id: message.conversationId }, data: { status: "AWAITING_CUSTOMER" } });

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/inbox");

  return { ok: true as const };
}

export async function updateConversationStageAction(conversationId: string, stage: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "pipeline", "edit");
  if (!permCheck.ok) return permCheck;

  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, tenantId: session.tenantId! },
  });
  if (!conversation) return { ok: false as const, error: "Conversation not found." };

  await db.conversation.update({ where: { id: conversationId }, data: { stage } });

  if (stage === "WON" || stage === "LOST") {
    await db.nexarisClient.update({
      where: { id: conversation.nexarisClientId },
      data: { tag: stage === "WON" ? "CONVERTED" : "LOST" },
    });
  }

  revalidatePath("/agency/pipeline");
  revalidatePath("/agency");

  return { ok: true as const };
}

export async function updateClientTagAction(clientId: string, tag: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "clients", "edit");
  if (!permCheck.ok) return permCheck;

  const client = await db.nexarisClient.findFirst({ where: { id: clientId, tenantId: session.tenantId! } });
  if (!client) return { ok: false as const, error: "Client not found." };

  await db.nexarisClient.update({ where: { id: clientId }, data: { tag } });

  revalidatePath("/agency/clients");
  return { ok: true as const };
}

export async function updateClientNotesAction(clientId: string, notes: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "clients", "edit");
  if (!permCheck.ok) return permCheck;

  const client = await db.nexarisClient.findFirst({ where: { id: clientId, tenantId: session.tenantId! } });
  if (!client) return { ok: false as const, error: "Client not found." };

  await db.nexarisClient.update({ where: { id: clientId }, data: { notes } });

  revalidatePath("/agency/clients");
  return { ok: true as const };
}
