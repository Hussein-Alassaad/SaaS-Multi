"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { generateAiReply, detectLanguage } from "@/lib/ai/respond";
import { logError } from "@/lib/error-log";
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

  const language = detectLanguage(input.body);

  // Everything the AI call needs is read/written in one tenant scope, which
  // is CLOSED before generateAiReply() runs -- that is a third-party LLM
  // request, and holding a pooled Postgres connection open across it would
  // tie up the pool for the length of an inference call.
  const { channel, nexarisClient, conversation, settings, knowledgeEntries, priorMessages, openSlots } =
    await withTenant(tenantId, async (tx) => {
      const channel = await tx.channel.upsert({
        where: { tenantId_provider: { tenantId, provider: input.provider } },
        update: {},
        create: { tenantId, provider: input.provider, status: "CONNECTED", connectedAt: new Date() },
      });

      let nexarisClient = input.customerPhone
        ? await tx.nexarisClient.findFirst({ where: { tenantId, phone: input.customerPhone } })
        : null;
      if (!nexarisClient) {
        nexarisClient = await tx.nexarisClient.create({
          data: { tenantId, name: input.customerName, phone: input.customerPhone },
        });
      }

      let conversation = await tx.conversation.findFirst({
        where: { tenantId, channelId: channel.id, nexarisClientId: nexarisClient.id, status: { not: "CLOSED" } },
      });
      if (!conversation) {
        conversation = await tx.conversation.create({
          data: { tenantId, channelId: channel.id, nexarisClientId: nexarisClient.id, language },
        });
      }

      await tx.message.create({
        data: { conversationId: conversation.id, sender: "CUSTOMER", body: input.body, language, status: "SENT" },
      });

      const settings = await tx.aiSettings.upsert({
        where: { tenantId },
        update: {},
        create: { tenantId },
      });
      const knowledgeEntries = await tx.knowledgeEntry.findMany({ where: { tenantId }, take: 10 });

      // Full thread so far, oldest first -- lets the AI hold context across
      // turns (not re-ask what the customer already told it) instead of
      // replying to each message in isolation.
      const priorMessages = await tx.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "asc" },
      });

      // Real open slots the owner has created (Agency > Meetings) -- the AI is
      // only ever shown genuinely bookable times, never invents one. Capped at
      // 10 so the prompt doesn't grow unbounded for a tenant with a long open
      // calendar; soonest-first already makes the earliest options the ones
      // most likely to matter to a customer asking "when are you free".
      const openSlots = await tx.meetingSlot.findMany({
        where: { tenantId, status: "AVAILABLE", startsAt: { gte: new Date() } },
        orderBy: { startsAt: "asc" },
        take: 10,
      });

      return { channel, nexarisClient, conversation, settings, knowledgeEntries, priorMessages, openSlots };
    });

  const aiReply = await generateAiReply({
    history: priorMessages.map((m) => ({
      sender: m.sender as "CUSTOMER" | "AI" | "HUMAN",
      body: m.body,
    })),
    language: settings.allowEnglish ? language : "AR",
    clientName: nexarisClient.name,
    knowledgeEntries: knowledgeEntries.map((k) => ({ title: k.title, body: k.body })),
    settings,
    tenantId,
    conversationId: conversation.id,
    availableSlots: openSlots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString() })),
  });

  // Second tenant scope, after the AI call has returned -- persists the
  // reply and everything derived from it.
  await withTenant(tenantId, async (tx) => {
    await tx.message.create({
      data: {
        conversationId: conversation.id,
        sender: "AI",
        body: aiReply.body,
        language: aiReply.language,
        status: aiReply.requiresApproval ? "PENDING_APPROVAL" : "SENT",
      },
    });

    // Apply whatever the AI has learned about this lead so far -- overwrites
    // rather than merges, since each extraction call sees the whole
    // conversation and produces its best current summary, not just what's
    // new this turn.
    await tx.nexarisClient.update({
      where: { id: nexarisClient.id },
      data: {
        name: aiReply.extracted.name ?? nexarisClient.name,
        needs: aiReply.extracted.needs ?? nexarisClient.needs,
        tag: aiReply.extracted.readyForHandoff && nexarisClient.tag === "REPLIED" ? "INTERESTED" : undefined,
      },
    });
  });

  // The AI only ever PROPOSES a slot in its reply text -- creating the
  // MeetingRequest here is what actually reserves it (PENDING_APPROVAL,
  // never AVAILABLE->BOOKED directly; approveMeetingRequestAction is still
  // the only place a slot becomes BOOKED). slotId is @unique on
  // MeetingRequest, so a slot already claimed by an earlier request in the
  // tiny gap between this action's own openSlots read and this write simply
  // fails the create -- caught and swallowed rather than surfaced, since the
  // reply text has already been sent either way and the customer's proposed
  // time not actually being reservable is a "team will confirm" case the
  // approval-stage human is better placed to resolve than a crashed request.
  let meetingProposed = false;
  if (aiReply.extracted.proposedSlotId) {
    try {
      // Its own scope: a unique-constraint failure here must roll back only
      // this create, not the reply persisted just above.
      await withTenant(tenantId, (tx) =>
        tx.meetingRequest.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            nexarisClientId: nexarisClient.id,
            slotId: aiReply.extracted.proposedSlotId!,
          },
        })
      );
      meetingProposed = true;
    } catch (err) {
      await logError({
        source: "ai.propose_meeting",
        error: err,
        tenantId,
        context: { conversationId: conversation.id, slotId: aiReply.extracted.proposedSlotId },
      });
    }
  }

  const nextStage = meetingProposed
    ? "MEETING_PENDING"
    : conversation.stage === "NEW"
      ? "CONTACTED"
      : conversation.stage;
  await withTenant(tenantId, (tx) =>
    tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        stage: nextStage,
        status: aiReply.requiresApproval ? "PENDING_APPROVAL" : "OPEN",
      },
    })
  );

  revalidatePath("/agency/inbox");
  revalidatePath("/agency/approvals");
  revalidatePath("/agency/pipeline");
  revalidatePath("/agency/meetings");
  revalidatePath("/agency");

  return { ok: true as const, conversationId: conversation.id };
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

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/inbox");

  return { ok: true as const };
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
