"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { sendOutreachEmail } from "@/lib/outreach/resend-email";
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
 *
 * DAILY CAP + BOUNCE SAFETY (added 2026-08-21): a brand-new sending domain
 * that blasts its full monthly quota in one day gets flagged as spam and
 * silently stops being delivered at all -- not a lower reply rate, an
 * invisible one (see outreach/PROGRESS.md's dated entry and the strategy
 * doc in Downloads/B2B_AI_Outreach_System_Complete_Guide.md, Part 5).
 * Approving a message no longer means it sends immediately: it always
 * atomically increments a per-account, per-UTC-day sent counter and only
 * actually calls SES if that count is still under
 * OutreachAccount.emailDailyLimit; over-cap approvals are marked
 * "queued_for_pacing" instead of "sent" or "failed" -- a real, later
 * automated pass (not yet built -- see the module docstring's "NOT YET
 * BUILT" note below) is what should actually dispatch those once a new
 * day's quota opens up. An account whose bounce rate crosses
 * BOUNCE_RATE_PAUSE_THRESHOLD is paused outright (status="warned") rather
 * than left to keep degrading the domain's reputation with every further
 * send -- the tenant sees this the same way an account-health warning from
 * the Python agent already shows (AccountHealthClient.tsx's warningType/
 * warningReason fields, reused here rather than inventing a parallel
 * mechanism).
 */
const BOUNCE_RATE_PAUSE_THRESHOLD = 0.02; // 2% -- SES's own recommended ceiling before deliverability degrades broadly
const BOUNCE_RATE_MIN_SAMPLE = 20; // don't act on bounce rate until there's enough sends to be a real signal, not noise from 1-2 early bounces

async function sendIfEmailChannel(tenantId: string, message: { id: string; leadId: string; channel: string; body: string; editedBody: string | null }) {
  if (message.channel !== "email") return;

  const lead = await db.outreachLead.findFirst({
    where: { id: message.leadId, tenantId },
    select: { businessName: true, contactEmail: true, accountId: true, doNotContact: true },
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
  if (lead.doNotContact) {
    // Hard stop, checked at the one real send call site -- a lead marked
    // Do Not Contact must never be emailed again, regardless of how this
    // message reached "approved" (human click or the auto-approve path in
    // scheduler.py). Mark the message failed rather than leaving it stuck
    // "approved"/"pending" forever, so it's visibly resolved, not silently
    // dropped.
    await db.outreachMessage.update({ where: { id: message.id }, data: { sendStatus: "failed" } });
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

  if (account.status === "paused" || account.status === "warned") {
    // Bounce-safety pause (or a manual pause) blocks new sends outright --
    // same "paused accounts never self-resume" rule the Python agent's
    // account_pool.py already enforces for LinkedIn/Instagram (core rule R9
    // in the original spec: redistribution/resuming is always a human call).
    await db.outreachMessage.update({ where: { id: message.id }, data: { sendStatus: "failed" } });
    await logError({
      source: "outreach.ses.send",
      error: new Error(`Email account is ${account.status} -- send blocked until manually resumed`),
      tenantId,
      context: { leadId: message.leadId, messageId: message.id, accountId: account.id },
    });
    return;
  }

  // Cap check + claim happen inside one transaction that takes a row lock on
  // the account (SELECT ... FOR UPDATE) BEFORE counting today's sends, and
  // the claim itself (marking THIS message "sent" so it counts toward the
  // cap) happens INSIDE that same locked transaction, before the real SES
  // call -- without this, concurrent calls (e.g. Approve All firing every
  // message in parallel via Promise.all, or an approval landing at the same
  // moment dispatchPacingQueueAction's cron runs) each read the same
  // "sentToday" count before any of them has written anything back, so all
  // of them can see room under the cap and all send -- blowing the daily
  // limit several times over, exactly the spam-flagging risk this cap
  // exists to prevent. The lock forces concurrent calls for the SAME
  // account to serialize (each waits for the prior one's transaction to
  // commit before it can read), so every count is accurate at the moment
  // it's checked AND claimed. Different accounts never block each other --
  // the lock is per-account-row. If the SES call below fails, the message
  // is corrected to "failed" afterward (see the catch below) -- worst case
  // on an unlikely process crash between claim and correction is one
  // message parked as "sent" with no real send behind it, versus this
  // race's actual failure mode of silently over-sending live cold emails.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const provisionalSentAt = new Date();
  const claimed = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "outreach_accounts" WHERE id = ${account.id} FOR UPDATE`;
    const sentToday = await tx.outreachMessage.count({
      where: { sentViaAccountId: account.id, sendStatus: "sent", sentAt: { gte: dayStart } },
    });
    if (sentToday >= account.emailDailyLimit) {
      // Approved, just not dispatched yet -- distinct from "failed" so the
      // dashboard/tenant can tell "this needs a fix" apart from "this is
      // fine, just waiting its turn" at a glance.
      await tx.outreachMessage.update({ where: { id: message.id }, data: { sendStatus: "queued_for_pacing" } });
      return false;
    }
    await tx.outreachMessage.update({
      where: { id: message.id },
      data: { sendStatus: "sent", sentAt: provisionalSentAt, sentViaAccountId: account.id },
    });
    return true;
  });
  if (!claimed) return;

  const result = await sendOutreachEmail({
    fromEmail: account.sesFromEmail,
    fromName: account.sesFromName,
    to: lead.contactEmail,
    subject: lead.businessName ? `Quick note for ${lead.businessName}` : "Quick note",
    html: (message.editedBody || message.body).replace(/\n/g, "<br />"),
  });

  if (!result.ok) {
    // Correct the provisional claim -- this send never actually happened,
    // so it must not count toward the cap or show as delivered.
    await db.outreachMessage.update({ where: { id: message.id }, data: { sendStatus: "failed" } });
  }

  if (result.ok && !result.skipped) {
    // sentCount is the bounce-rate denominator (maybePauseForBounceRate) --
    // incremented here, at the one real send call site, rather than derived
    // by counting outreach_messages rows each time, so a real SES send
    // always has a matching counter bump with no separate query needed to
    // reconstruct it.
    await db.outreachAccount.update({ where: { id: account.id }, data: { sentCount: { increment: 1 } } });
    await maybePauseForBounceRate(tenantId, account.id);
  }
}

/**
 * Checked after every real (non-skipped) send, not on a separate schedule --
 * bounce rate is read directly from OutreachAccount.bounceCount /
 * sentCount (updated by the SES bounce handler -- see
 * src/app/api/webhooks/ses-bounce/route.ts's "NOT YET BUILT" note) rather
 * than computed here from scratch each time, since a bounce can arrive
 * (via SES's async notification) well after the send that triggered it.
 */
async function maybePauseForBounceRate(tenantId: string, accountId: string): Promise<void> {
  const account = await db.outreachAccount.findFirst({ where: { id: accountId, tenantId } });
  if (!account || account.sentCount < BOUNCE_RATE_MIN_SAMPLE) return;

  const bounceRate = account.bounceCount / account.sentCount;
  if (bounceRate <= BOUNCE_RATE_PAUSE_THRESHOLD) return;

  await db.outreachAccount.update({
    where: { id: accountId },
    data: {
      status: "warned",
      warningType: "high_bounce_rate",
      warningReason: `Bounce rate ${(bounceRate * 100).toFixed(1)}% over ${account.sentCount} sends exceeds the ${(BOUNCE_RATE_PAUSE_THRESHOLD * 100).toFixed(0)}% safety threshold -- sending paused to protect this domain's reputation. Review the contact list quality, then resume manually from Account Health.`,
    },
  });
}

/**
 * Redispatches every pending email across every Outreach tenant that's
 * either (a) "queued_for_pacing" -- held back by a daily cap that may have
 * opened up since, or (b) freshly "approved" with sendStatus still
 * "pending" -- the case a tenant's OutreachSettings.approvalRequired=false
 * (Settings > Contact rules > "Require approval before sending") produces:
 * the Python agent's message-generation cycle (scheduler.py) auto-approves
 * the message the moment it's generated, but has no way to trigger the
 * actual SES call itself (email sending is entirely owned by this Next.js
 * app, per outreach-errors.ts's/repositories.py's own module docstrings --
 * the agent never touches it), so without this second case an
 * auto-approved email would sit "approved" forever, never dispatched,
 * until a human happened to visit the Approvals page. Reuses
 * sendIfEmailChannel() itself rather than duplicating the daily-cap/
 * bounce-check logic: that function already re-checks the cap fresh on
 * every call, so simply calling it here is correct whether the cap has
 * room (it sends) or not (it moves to/stays queued, no-op either way).
 * Meant to be called on a schedule (see
 * src/app/api/cron/dispatch-pacing/route.ts), not from the UI.
 */
export async function dispatchPacingQueueAction(): Promise<{ ok: true; processed: number }> {
  const queued = await db.outreachMessage.findMany({
    where: {
      channel: "email",
      OR: [
        { sendStatus: "queued_for_pacing" },
        { sendStatus: "pending", approvalStatus: "approved" },
      ],
    },
    select: { id: true, leadId: true, channel: true, body: true, editedBody: true, tenantId: true },
  });

  for (const message of queued) {
    await sendIfEmailChannel(message.tenantId, message);
  }

  return { ok: true, processed: queued.length };
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
