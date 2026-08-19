"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { sendOutreachEmail } from "@/lib/outreach/ses";
import { logError } from "@/lib/error-log";

function serializeApprovalMessage(
  message: Awaited<ReturnType<typeof db.outreachMessage.findMany>>[number] & {
    lead: { id: string; businessName: string | null; platform: string; score: number | null; temperature: string | null };
  }
) {
  return {
    id: message.id,
    leadId: message.leadId,
    channel: message.channel,
    body: message.body,
    editedBody: message.editedBody,
    approvalStatus: message.approvalStatus,
    lead: {
      id: message.lead.id,
      businessName: message.lead.businessName,
      platform: message.lead.platform,
      score: message.lead.score,
      temperature: message.lead.temperature,
    },
  };
}

export async function getApprovalQueueAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "approvals", "view");
  if (!permCheck.ok) return permCheck;

  const messages = await db.outreachMessage.findMany({
    where: { tenantId: session.tenantId!, approvalStatus: "awaiting" },
    include: { lead: { select: { id: true, businessName: true, platform: true, score: true, temperature: true } } },
    orderBy: { createdAt: "asc" },
  });

  return { ok: true as const, messages: messages.map(serializeApprovalMessage) };
}

/**
 * A lead only advances to "approved" once every one of its messages
 * clears approval -- mirrors agent/messaging/approval.py's rule exactly
 * (duplicated here, not shared code, since this runs in the browser/server
 * and that runs in the Python agent; the two stay in sync by being built
 * against the same rule, not by importing across languages).
 */
async function maybeAdvanceLead(tenantId: string, leadId: string, changedBy: string) {
  const messages = await db.outreachMessage.findMany({
    where: { tenantId, leadId },
    select: { approvalStatus: true },
  });
  if (messages.length > 0 && messages.every((m) => m.approvalStatus === "approved")) {
    await db.$transaction([
      db.outreachLead.update({ where: { id: leadId }, data: { status: "approved" } }),
      db.outreachPipelineHistory.create({
        data: { tenantId, leadId, fromStage: "awaiting_approval", toStage: "approved", changedBy },
      }),
    ]);
  }
}

/**
 * Email is the one channel that can send directly from this app (via SES)
 * rather than needing the Python agent's browser automation (LinkedIn) or a
 * human click (Instagram manual send) -- so approving an email message
 * fires the real send immediately, same moment LinkedIn's approval would
 * hand off to agent/sending/linkedin_send.py. Failure to send does NOT
 * revert the approval (the human already approved the content; a delivery
 * failure is a send-infrastructure problem, logged for the Errors page,
 * not a reason to re-queue it for re-approval).
 */
async function sendIfEmailChannel(tenantId: string, message: { id: string; leadId: string; channel: string; body: string; editedBody: string | null }) {
  if (message.channel !== "email") return;

  const lead = await db.outreachLead.findFirst({
    where: { id: message.leadId, tenantId },
    select: { businessName: true, contactEmail: true, accountId: true },
  });
  if (!lead?.contactEmail) {
    await logError({
      source: "outreach.ses.send",
      error: new Error("Lead has no contact email on file"),
      tenantId,
      context: { leadId: message.leadId, messageId: message.id },
    });
    return;
  }

  const account = lead.accountId
    ? await db.outreachAccount.findUnique({ where: { id: lead.accountId } })
    : await db.outreachAccount.findFirst({ where: { tenantId, platform: "email", status: "active" } });
  if (!account?.sesFromEmail) {
    await logError({
      source: "outreach.ses.send",
      error: new Error("No email-sending account configured for this tenant"),
      tenantId,
      context: { leadId: message.leadId, messageId: message.id },
    });
    return;
  }

  const result = await sendOutreachEmail({
    fromEmail: account.sesFromEmail,
    fromName: account.sesFromName,
    to: lead.contactEmail,
    subject: lead.businessName ? `Quick note for ${lead.businessName}` : "Quick note",
    html: (message.editedBody || message.body).replace(/\n/g, "<br />"),
  });

  const now = new Date();
  await db.outreachMessage.update({
    where: { id: message.id },
    data: result.ok ? { sendStatus: "sent", sentAt: now, sentViaAccountId: account.id } : { sendStatus: "failed" },
  });
}

export async function approveMessageAction(messageId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const message = await db.outreachMessage.findFirst({ where: { id: messageId, tenantId: session.tenantId! } });
  if (!message) return { ok: false as const, error: "Message not found." };

  await db.outreachMessage.update({
    where: { id: messageId },
    data: { approvalStatus: "approved", approvedById: session.id, approvedAt: new Date() },
  });
  await maybeAdvanceLead(session.tenantId!, message.leadId, session.name ?? session.id);
  await sendIfEmailChannel(session.tenantId!, message);

  return { ok: true as const };
}

export async function holdMessageAction(messageId: string, reason?: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const message = await db.outreachMessage.findFirst({ where: { id: messageId, tenantId: session.tenantId! } });
  if (!message) return { ok: false as const, error: "Message not found." };

  await db.outreachMessage.update({
    where: { id: messageId },
    data: { approvalStatus: "held", holdReason: reason || null },
  });

  return { ok: true as const };
}

export async function saveMessageEditAction(messageId: string, editedBody: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const message = await db.outreachMessage.findFirst({ where: { id: messageId, tenantId: session.tenantId! } });
  if (!message) return { ok: false as const, error: "Message not found." };

  await db.outreachMessage.update({
    where: { id: messageId },
    data: { editedBody, approvalStatus: "edited" },
  });

  return { ok: true as const };
}

export async function approveAllMessagesAction(messageIds: string[]) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const messages = await db.outreachMessage.findMany({
    where: { id: { in: messageIds }, tenantId: session.tenantId!, approvalStatus: { not: "held" } },
    select: { id: true, leadId: true, channel: true, body: true, editedBody: true },
  });
  if (messages.length === 0) return { ok: true as const, approvedCount: 0 };

  await db.outreachMessage.updateMany({
    where: { id: { in: messages.map((m) => m.id) } },
    data: { approvalStatus: "approved", approvedById: session.id, approvedAt: new Date() },
  });

  const leadIds = [...new Set(messages.map((m) => m.leadId))];
  await Promise.all(leadIds.map((leadId) => maybeAdvanceLead(session.tenantId!, leadId, session.name ?? session.id)));
  await Promise.all(messages.map((m) => sendIfEmailChannel(session.tenantId!, m)));

  return { ok: true as const, approvedCount: messages.length };
}
