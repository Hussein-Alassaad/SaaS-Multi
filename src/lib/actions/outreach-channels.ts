"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult, type OutreachResource } from "@/lib/outreach-permissions";

export async function getInstagramManualQueueAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "instagram-manual", "view");
  if (!permCheck.ok) return permCheck;

  const messages = await withTenant(session.tenantId!, (tx) =>
    tx.outreachMessage.findMany({
      where: { tenantId: session.tenantId!, channel: "instagram", sendStatus: "manual_send_pending" },
      include: {
        lead: { select: { id: true, businessName: true, profileUrl: true, contactCount: true, firstContactedAt: true, status: true } },
      },
      orderBy: { createdAt: "asc" },
    })
  );

  return {
    ok: true as const,
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      editedBody: m.editedBody,
      isReply: m.isReply,
      lead: {
        id: m.lead.id,
        businessName: m.lead.businessName,
        profileUrl: m.lead.profileUrl,
      },
    })),
  };
}

/**
 * Instagram never auto-sends -- mirrors agent/sending/instagram_queue.py's
 * mark_sent() exactly: bump contact_count, set first_contacted_at only
 * once, move the lead to "contacted".
 *
 * A reply (isReply, from "Reply Here") skips all of that bookkeeping: the
 * lead's first-contact/pipeline move already happened when the ORIGINAL
 * outbound message was sent, so re-running it here would wrongly reset a
 * lead that's already past "contacted" (e.g. "replied") back to
 * "contacted", and double-count contact_count for what's actually an
 * ongoing conversation, not a new contact. See instagram_queue.py's
 * mark_sent() for the same guard on the Python side.
 */
export async function markInstagramSentAction(messageId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "instagram-manual", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const message = await tx.outreachMessage.findFirst({
      where: { id: messageId, tenantId: session.tenantId! },
      include: { lead: true },
    });
    if (!message) return false;

    const now = new Date();

    if (message.isReply) {
      await tx.outreachMessage.update({ where: { id: messageId }, data: { sendStatus: "sent", sentAt: now } });
      return true;
    }

    const fromStage = message.lead.status;

    // Was a db.$transaction([...]) array before RLS -- Prisma can't nest a
    // transaction inside the withTenant() one, so these four writes are now
    // issued sequentially against the same `tx`. Still one atomic unit.
    await tx.outreachMessage.update({ where: { id: messageId }, data: { sendStatus: "sent", sentAt: now } });
    await tx.outreachLead.update({
      where: { id: message.leadId },
      data: {
        contactCount: { increment: 1 },
        firstContactedAt: message.lead.firstContactedAt ?? now,
        status: "contacted",
      },
    });
    await tx.outreachPipelineHistory.create({
      data: { tenantId: session.tenantId!, leadId: message.leadId, fromStage, toStage: "contacted", changedBy: "agent" },
    });
    await tx.outreachClientHistory.updateMany({ where: { leadId: message.leadId }, data: { contacted: true } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Message not found." };

  return { ok: true as const };
}

export async function getChannelActivityAction(channel: "linkedin" | "email") {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const resource: OutreachResource = channel === "email" ? "email" : "linkedin";
  const permCheck = outreachGuardResult(session.role?.name ?? "", resource, "view");
  if (!permCheck.ok) return permCheck;

  // Sequential rather than Promise.all -- these share one TransactionClient
  // now, which can't have multiple queries in flight on it at once.
  const { messages, replies, accounts } = await withTenant(session.tenantId!, async (tx) => {
    const messages = await tx.outreachMessage.findMany({
      where: { tenantId: session.tenantId!, channel },
      include: { lead: { select: { id: true, businessName: true, profileUrl: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const replies = await tx.outreachReply.findMany({
      where: { tenantId: session.tenantId!, channel },
      include: { lead: { select: { id: true, businessName: true } } },
      orderBy: { repliedAt: "desc" },
      take: 20,
    });
    const accounts = await tx.outreachAccount.findMany({ where: { tenantId: session.tenantId!, platform: channel } });
    return { messages, replies, accounts };
  });

  return {
    ok: true as const,
    messages: messages.map((m) => ({
      id: m.id,
      body: m.body,
      editedBody: m.editedBody,
      sendStatus: m.sendStatus,
      sentAt: m.sentAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      lead: { id: m.lead.id, businessName: m.lead.businessName },
      deliveryStatus: m.deliveryStatus,
      deliveryStatusAt: m.deliveryStatusAt?.toISOString() ?? null,
    })),
    replies: replies.map((r) => ({
      id: r.id,
      body: r.body,
      repliedAt: r.repliedAt.toISOString(),
      lead: { businessName: r.lead.businessName },
    })),
    accounts: accounts.map((a) => {
      // LIVE-CONFIRMED 2026-09-02: this box's label used to read
      // "{warmupCurrentLimit}/{dailyLimit} daily limit" -- both are
      // CONFIGURATION values (the account's current warm-up-ramped cap
      // and its steady-state ceiling), neither is how many messages this
      // account has actually sent today. A real tenant read that as a
      // progress counter ("10 of 10 already sent") and was confused when
      // the real count was 0-1 -- this computes the genuine sent-today
      // count from `messages` (already fetched above, no extra query) so
      // the label can show the real number instead.
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const sentToday = messages.filter(
        (m) => m.sentViaAccountId === a.id && m.sendStatus === "sent" && m.sentAt && m.sentAt >= todayStart
      ).length;
      return {
        id: a.id,
        label: a.label,
        status: a.status,
        warningReason: a.warningReason,
        dailyLimit: channel === "email" ? a.emailDailyLimit : a.linkedinDailyLimit,
        warmupCurrentLimit: a.warmupCurrentLimit,
        sentToday,
      };
    }),
  };
}
