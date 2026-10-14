/**
 * The two things the agency agent must do on a clock rather than in answer to
 * a message, run every minute by /api/cron/agency-tick:
 *
 *  1. Remind the customer an hour before a confirmed phone call.
 *  2. Alert the admin when a customer wrote and nobody has answered for a
 *     while -- the safety net for a reply that never got produced (the server
 *     died mid-reply, the AI budget ran out, a webhook was lost).
 *
 * Both are safe to run as often as you like: each step claims its work with a
 * conditional UPDATE or checks for an existing alert first, so a second run
 * (or two overlapping runs) does nothing twice.
 */

import { db, withPlatformAccess, withTenant } from "@/lib/db";
import { logError } from "@/lib/error-log";
import { createAlertIn } from "@/lib/agency/alerts";
import { deliverMessage } from "@/lib/channels/dispatch";
import { isWithinCustomerServiceWindow } from "@/lib/channels/whatsapp";
import { formatSlotLabel, safeTimezone, type SlotLabelLanguage } from "@/lib/agency/slots";
import { reminderText } from "@/lib/agency/language";

const REMINDER_LEAD_MS = 65 * 60 * 1000; // sent when the call is within ~an hour; a minute-level clock keeps it near 60
export const UNANSWERED_AFTER_MS = 10 * 60 * 1000;
const UNANSWERED_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const UNANSWERED_TITLE = "A customer is waiting for an answer";

export async function sendMeetingReminders(now = new Date()): Promise<{ sent: number; skipped: number }> {
  const due = await withPlatformAccess((tx) =>
    tx.meetingRequest.findMany({
      where: { status: "APPROVED", reminderSentAt: null, slot: { startsAt: { lte: new Date(now.getTime() + REMINDER_LEAD_MS) } } },
      select: {
        id: true,
        tenantId: true,
        conversationId: true,
        slot: { select: { startsAt: true } },
        conversation: { select: { language: true, lastCustomerMessageAt: true } },
      },
      take: 100,
    })
  );

  let sent = 0;
  let skipped = 0;
  for (const m of due) {
    try {
      // Claim first: only one run ever handles a given meeting.
      const claimed = await withTenant(m.tenantId, (tx) =>
        tx.meetingRequest.updateMany({ where: { id: m.id, reminderSentAt: null }, data: { reminderSentAt: now } })
      );
      if (claimed.count === 0) continue;

      // Too late to be a useful reminder, or WhatsApp/Instagram/Facebook would refuse the message anyway.
      if (m.slot.startsAt.getTime() <= now.getTime() || !isWithinCustomerServiceWindow(m.conversation.lastCustomerMessageAt, now)) {
        skipped++;
        continue;
      }

      const tz = safeTimezone((await db.localizationSettings.findUnique({ where: { tenantId: m.tenantId }, select: { timezone: true } }).catch(() => null))?.timezone);
      const label = formatSlotLabel(m.slot.startsAt, tz, m.conversation.language as SlotLabelLanguage);
      const message = await withTenant(m.tenantId, (tx) =>
        tx.message.create({
          data: { conversationId: m.conversationId, sender: "HUMAN", body: reminderText(m.conversation.language, label), language: m.conversation.language, status: "APPROVED" },
        })
      );
      await deliverMessage(m.tenantId, message.id);
      sent++;
    } catch (err) {
      await logError({ source: "agency.meeting_reminder", error: err, tenantId: m.tenantId, context: { meetingRequestId: m.id } });
    }
  }
  return { sent, skipped };
}

export async function alertUnansweredCustomers(now = new Date()): Promise<{ alerted: number }> {
  const candidates = await withPlatformAccess((tx) =>
    tx.conversation.findMany({
      where: {
        aiPaused: false,
        status: { not: "CLOSED" },
        lastCustomerMessageAt: { gte: new Date(now.getTime() - UNANSWERED_LOOKBACK_MS), lte: new Date(now.getTime() - UNANSWERED_AFTER_MS) },
      },
      select: {
        id: true,
        tenantId: true,
        nexarisClient: { select: { name: true, phone: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { sender: true, body: true, createdAt: true } },
      },
      take: 300,
    })
  );

  // Only chats whose newest message is the customer's, and that are older than the grace period.
  const waiting = candidates.filter((c) => {
    const last = c.messages[0];
    return last && last.sender === "CUSTOMER" && last.createdAt.getTime() <= now.getTime() - UNANSWERED_AFTER_MS;
  });
  if (waiting.length === 0) return { alerted: 0 };

  // Someone has already been told about this message (budget stop, send failure, "needs a person") -- don't pile on.
  // NEW_CONVERSATION doesn't count: it is raised the moment the message arrives, long before we know whether it got answered.
  const existing = await withPlatformAccess((tx) =>
    tx.tenantAlert.findMany({
      where: { conversationId: { in: waiting.map((c) => c.id) }, type: { not: "NEW_CONVERSATION" }, createdAt: { gte: new Date(now.getTime() - UNANSWERED_LOOKBACK_MS) } },
      select: { conversationId: true, createdAt: true },
    })
  );

  let alerted = 0;
  for (const c of waiting) {
    const last = c.messages[0];
    if (existing.some((a) => a.conversationId === c.id && a.createdAt.getTime() >= last.createdAt.getTime())) continue;
    try {
      await withTenant(c.tenantId, (tx) =>
        createAlertIn(tx, {
          tenantId: c.tenantId,
          type: "NEEDS_ATTENTION",
          title: UNANSWERED_TITLE,
          body: `${c.nexarisClient.name ?? c.nexarisClient.phone ?? "A customer"} wrote and nobody has answered: ${last.body.slice(0, 160)}`,
          conversationId: c.id,
        })
      );
      alerted++;
    } catch (err) {
      await logError({ source: "agency.unanswered_alert", error: err, tenantId: c.tenantId, context: { conversationId: c.id } });
    }
  }
  return { alerted };
}
