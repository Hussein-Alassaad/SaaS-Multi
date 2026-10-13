/**
 * One customer message in -> stored, answered by the AI (or left to a human),
 * meeting proposed if the customer is interested, admin alerted.
 *
 * Shared by the real WhatsApp webhook and the "Simulate incoming message"
 * button so both behave identically. The AI call (a third-party request) is
 * made between two short tenant scopes, never inside one, so a pooled Postgres
 * connection is not held open for the length of an inference call.
 */

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { generateAiReply, detectLanguage } from "@/lib/ai/respond";
import { selectKnowledge } from "@/lib/ai/knowledge";
import { checkAiBudget } from "@/lib/ai/usage";
import { logError } from "@/lib/error-log";
import { createAlertIn } from "@/lib/agency/alerts";
import { deliverMessage } from "@/lib/channels/dispatch";
import { ensureMeetingSlots, formatSlotLabel, safeTimezone, spreadAcrossDays } from "@/lib/agency/slots";

export interface InboundInput {
  tenantId: string;
  channelId: string;
  /** The customer's id on the channel (WhatsApp wa_id). Null for simulated messages. */
  externalContactId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  body: string;
  /** The channel's id for this message (wamid). Used to drop duplicate webhook deliveries. */
  externalMessageId?: string;
}

export type InboundResult =
  | { ok: true; conversationId: string; duplicate?: false; aiReplied: boolean; messageId?: string }
  | { ok: true; duplicate: true };

const HISTORY_LIMIT = 30;

/** Accepts what a customer types ('70 123 456', '+961 70 123456'); returns null unless it looks like a phone number. */
export function normalizePhone(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return undefined;
  return raw.trim().startsWith("+") ? `+${digits}` : digits;
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function processInboundMessage(input: InboundInput): Promise<InboundResult> {
  const { tenantId } = input;
  const language = detectLanguage(input.body);
  const who = input.customerName ?? input.customerPhone ?? "A customer";

  let ctx;
  try {
    ctx = await withTenant(tenantId, async (tx) => {
      if (input.externalMessageId) {
        const seen = await tx.message.findUnique({ where: { externalId: input.externalMessageId }, select: { id: true } });
        if (seen) return null;
      }

      // Conversation first: on Instagram/Messenger there is no phone number to match a client on, so the
      // customer's id on the channel is the only thing that says "this is the same person as last time".
      let conversation = input.externalContactId
        ? await tx.conversation.findFirst({
            where: { tenantId, channelId: input.channelId, externalContactId: input.externalContactId, status: { not: "CLOSED" } },
            orderBy: { lastMessageAt: "desc" },
          })
        : null;
      let client = conversation
        ? await tx.nexarisClient.findUnique({ where: { id: conversation.nexarisClientId } })
        : input.customerPhone
          ? await tx.nexarisClient.findFirst({ where: { tenantId, phone: input.customerPhone } })
          : input.externalContactId
            ? (
                await tx.conversation.findFirst({
                  where: { tenantId, channelId: input.channelId, externalContactId: input.externalContactId },
                  orderBy: { lastMessageAt: "desc" },
                  include: { nexarisClient: true },
                })
              )?.nexarisClient ?? null
            : null;
      if (!client) {
        client = await tx.nexarisClient.create({ data: { tenantId, name: input.customerName, phone: input.customerPhone } });
      }
      if (!conversation && !input.externalContactId) {
        conversation = await tx.conversation.findFirst({
          where: { tenantId, channelId: input.channelId, nexarisClientId: client.id, status: { not: "CLOSED" } },
          orderBy: { lastMessageAt: "desc" },
        });
      }
      const isNewConversation = !conversation;
      const now = new Date();
      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            tenantId,
            channelId: input.channelId,
            nexarisClientId: client.id,
            language,
            externalContactId: input.externalContactId,
            lastCustomerMessageAt: now,
          },
        });
      } else {
        conversation = await tx.conversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: now, lastCustomerMessageAt: now, language },
        });
      }

      await tx.message.create({
        data: {
          conversationId: conversation.id,
          sender: "CUSTOMER",
          body: input.body,
          language,
          status: "SENT",
          externalId: input.externalMessageId,
        },
      });

      if (isNewConversation) {
        await createAlertIn(tx, {
          tenantId,
          type: "NEW_CONVERSATION",
          title: "New conversation",
          body: `${who}: ${input.body.slice(0, 160)}`,
          conversationId: conversation.id,
        });
      }

      const settings = await tx.aiSettings.upsert({ where: { tenantId }, update: {}, create: { tenantId } });
      const knowledge = await tx.knowledgeEntry.findMany({ where: { tenantId }, take: 200 });
      const recent = await tx.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
        take: HISTORY_LIMIT,
      });
      const localization = await tx.localizationSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
      const timezone = safeTimezone(localization?.timezone);
      // Working-hours slots are created on demand, so the owner never has to add them by hand.
      await ensureMeetingSlots(tx, tenantId, settings, timezone);
      const upcoming = await tx.meetingSlot.findMany({
        where: { tenantId, status: "AVAILABLE", startsAt: { gte: new Date(Date.now() + 60 * 60 * 1000) } },
        orderBy: { startsAt: "asc" },
        take: 60,
      });
      const openSlots = spreadAcrossDays(upcoming, timezone);

      return { client, conversation, settings, knowledge, history: recent.reverse(), openSlots, timezone, isNewConversation };
    });
  } catch (err) {
    // A webhook retry that raced the first delivery trips the unique wamid index -- that is "already handled", not an error.
    if (isUniqueViolation(err)) return { ok: true, duplicate: true };
    throw err;
  }
  if (!ctx) return { ok: true, duplicate: true };

  const { client, conversation, settings, knowledge, history, openSlots, timezone } = ctx;

  // A person has taken over this chat: store the message, tell the admin, say nothing.
  if (conversation.aiPaused) {
    await withTenant(tenantId, (tx) =>
      createAlertIn(tx, {
        tenantId,
        type: "NEEDS_ATTENTION",
        title: "Customer replied in a chat you took over",
        body: `${who}: ${input.body.slice(0, 160)}`,
        conversationId: conversation.id,
      })
    );
    return { ok: true, conversationId: conversation.id, aiReplied: false };
  }

  const budget = await checkAiBudget(tenantId);
  if (!budget.allowed) {
    await withTenant(tenantId, async (tx) => {
      await createAlertIn(tx, {
        tenantId,
        type: "AI_BUDGET",
        title: "AI did not reply: " + budget.reason,
        body: `${who} wrote: ${input.body.slice(0, 160)}. Please reply yourself.`,
        conversationId: conversation.id,
      });
      await tx.conversation.update({ where: { id: conversation.id }, data: { status: "PENDING_APPROVAL" } });
    });
    return { ok: true, conversationId: conversation.id, aiReplied: false };
  }

  const replyLanguage = settings.allowEnglish ? language : "AR";
  const slotLabels = new Map(openSlots.map((s) => [s.id, formatSlotLabel(s.startsAt, timezone, replyLanguage)]));
  const aiReply = await generateAiReply({
    history: history.map((m) => ({ sender: m.sender as "CUSTOMER" | "AI" | "HUMAN", body: m.body })),
    language: replyLanguage,
    clientName: client.name,
    clientPhone: client.phone,
    knowledgeEntries: selectKnowledge(knowledge, input.body).map((k) => ({ title: k.title, body: k.body })),
    settings,
    tenantId,
    conversationId: conversation.id,
    availableSlots: openSlots.map((s) => ({ id: s.id, startsAt: s.startsAt.toISOString(), label: slotLabels.get(s.id)! })),
  });

  const extracted = aiReply.extracted;
  const aiMessage = await withTenant(tenantId, async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        sender: "AI",
        body: aiReply.body,
        language: aiReply.language,
        status: aiReply.requiresApproval ? "PENDING_APPROVAL" : "SENT",
      },
    });

    await tx.nexarisClient.update({
      where: { id: client.id },
      data: {
        name: extracted.name ?? client.name,
        needs: extracted.needs ?? client.needs,
        // Instagram/Facebook give no phone number; when the customer types one for the call, keep it (never overwrite a known one).
        phone: client.phone ? undefined : normalizePhone(extracted.phone),
        tag: extracted.readyForHandoff && client.tag === "REPLIED" ? "INTERESTED" : undefined,
      },
    });

    if (aiReply.requiresApproval || extracted.needsHuman) {
      await createAlertIn(tx, {
        tenantId,
        type: "NEEDS_ATTENTION",
        title: extracted.needsHuman ? "A customer needs a person" : "A reply is waiting for your approval",
        body: `${who}: ${input.body.slice(0, 160)}`,
        conversationId: conversation.id,
      });
    }
    return message;
  });

  // The AI only PROPOSES a slot in its text; creating the MeetingRequest is what reserves it (still PENDING_APPROVAL --
  // approveMeetingRequestAction remains the only place a slot becomes BOOKED). slotId is unique, so a slot claimed a
  // moment ago by someone else just fails this create and is logged; the team resolves it when they see the chat.
  let meetingProposed = false;
  if (extracted.proposedSlotId) {
    try {
      await withTenant(tenantId, async (tx) => {
        await tx.meetingRequest.create({
          data: { tenantId, conversationId: conversation.id, nexarisClientId: client.id, slotId: extracted.proposedSlotId! },
        });
        await createAlertIn(tx, {
          tenantId,
          type: "MEETING_REQUESTED",
          title: `Meeting offered: ${slotLabels.get(extracted.proposedSlotId!) ?? "a time"}`,
          body: `${who} was offered this time. Call on: ${client.phone ?? normalizePhone(extracted.phone) ?? "number not given yet (ask in the chat)"}. Open Meetings to confirm it.`,
          conversationId: conversation.id,
        });
      });
      meetingProposed = true;
    } catch (err) {
      await logError({ source: "ai.propose_meeting", error: err, tenantId, context: { conversationId: conversation.id, slotId: extracted.proposedSlotId } });
    }
  }

  await withTenant(tenantId, (tx) =>
    tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        stage: meetingProposed ? "MEETING_PENDING" : conversation.stage === "NEW" ? "CONTACTED" : conversation.stage,
        status: aiReply.requiresApproval ? "PENDING_APPROVAL" : "OPEN",
        // The AI said a person should take over: stop it answering the next messages until someone resumes it.
        ...(extracted.needsHuman ? { aiPaused: true } : {}),
      },
    })
  );

  if (!aiReply.requiresApproval) {
    // Failure is recorded on the message and raised as an alert inside deliverMessage; it must not fail the inbound.
    await deliverMessage(tenantId, aiMessage.id).catch((err) =>
      logError({ source: "channels.deliver", error: err, tenantId, context: { messageId: aiMessage.id } })
    );
  }

  return { ok: true, conversationId: conversation.id, aiReplied: true, messageId: aiMessage.id };
}
