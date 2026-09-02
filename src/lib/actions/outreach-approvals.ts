"use server";

import { db, withTenant, withPlatformAccess } from "@/lib/db";
import type { Prisma } from "@prisma/client";
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

  const messages = await withTenant(session.tenantId!, (tx) =>
    tx.outreachMessage.findMany({
      where: { tenantId: session.tenantId!, approvalStatus: "awaiting" },
      include: { lead: { select: { id: true, businessName: true, platform: true, score: true, temperature: true } } },
      orderBy: { createdAt: "asc" },
    })
  );

  return { ok: true as const, messages: messages.map(serializeApprovalMessage) };
}

/**
 * A lead only advances to "approved" once every one of its messages
 * clears approval -- mirrors agent/messaging/approval.py's rule exactly
 * (duplicated here, not shared code, since this runs in the browser/server
 * and that runs in the Python agent; the two stay in sync by being built
 * against the same rule, not by importing across languages).
 */
async function maybeAdvanceLead(tx: Prisma.TransactionClient, tenantId: string, leadId: string, changedBy: string) {
  const messages = await tx.outreachMessage.findMany({
    where: { tenantId, leadId },
    select: { approvalStatus: true },
  });
  if (messages.length > 0 && messages.every((m) => m.approvalStatus === "approved")) {
    // Was a db.$transaction([...]) array before RLS -- Prisma can't nest a
    // transaction inside the withTenant() transaction this now runs in, so
    // the two writes are issued sequentially against the SAME `tx`. Still
    // atomic: they share the caller's single enclosing transaction.
    await tx.outreachLead.update({ where: { id: leadId }, data: { status: "approved" } });
    await tx.outreachPipelineHistory.create({
      data: { tenantId, leadId, fromStage: "awaiting_approval", toStage: "approved", changedBy },
    });
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

  // Everything up to (but NOT including) the real SES network call runs
  // inside one withTenant transaction: the lead/account lookups, the
  // bounce/pause guards, and the locked cap-check-and-claim. The SES call
  // itself is deliberately OUTSIDE it -- holding a Postgres transaction
  // (and the FOR UPDATE row lock below) open across a third-party HTTP
  // request would pin a pooled connection and block every concurrent
  // approval for the same account on network latency. The claim is
  // committed before the send and corrected afterward if the send fails,
  // which is the same ordering this had pre-RLS.
  const prepared = await withTenant(tenantId, async (tx) => {
    const lead = await tx.outreachLead.findFirst({
      where: { id: message.leadId, tenantId },
      select: { businessName: true, contactEmail: true, accountId: true, doNotContact: true },
    });
    if (!lead?.contactEmail) {
      return { kind: "error" as const, message: "Lead has no contact email on file", context: {} };
    }
    if (lead.doNotContact) {
      // Hard stop, checked at the one real send call site -- a lead marked
      // Do Not Contact must never be emailed again, regardless of how this
      // message reached "approved" (human click or the auto-approve path in
      // scheduler.py). Mark the message failed rather than leaving it stuck
      // "approved"/"pending" forever, so it's visibly resolved, not silently
      // dropped.
      await tx.outreachMessage.update({ where: { id: message.id }, data: { sendStatus: "failed" } });
      return { kind: "stop" as const };
    }

    const account = lead.accountId
      ? await tx.outreachAccount.findUnique({ where: { id: lead.accountId } })
      : await tx.outreachAccount.findFirst({ where: { tenantId, platform: "email", status: "active" } });
    if (!account?.sesFromEmail) {
      return { kind: "error" as const, message: "No email-sending account configured for this tenant", context: {} };
    }

    if (account.status === "paused" || account.status === "warned") {
      // Bounce-safety pause (or a manual pause) blocks new sends outright --
      // same "paused accounts never self-resume" rule the Python agent's
      // account_pool.py already enforces for LinkedIn/Instagram (core rule R9
      // in the original spec: redistribution/resuming is always a human call).
      await tx.outreachMessage.update({ where: { id: message.id }, data: { sendStatus: "failed" } });
      return {
        kind: "error" as const,
        message: `Email account is ${account.status} -- send blocked until manually resumed`,
        context: { accountId: account.id },
      };
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
    // is corrected to "failed" afterward -- worst case on an unlikely
    // process crash between claim and correction is one message parked as
    // "sent" with no real send behind it, versus this race's actual failure
    // mode of silently over-sending live cold emails.
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    await tx.$queryRaw`SELECT id FROM "outreach_accounts" WHERE id = ${account.id} FOR UPDATE`;
    const sentToday = await tx.outreachMessage.count({
      where: { sentViaAccountId: account.id, sendStatus: "sent", sentAt: { gte: dayStart } },
    });
    if (sentToday >= account.emailDailyLimit) {
      // Approved, just not dispatched yet -- distinct from "failed" so the
      // dashboard/tenant can tell "this needs a fix" apart from "this is
      // fine, just waiting its turn" at a glance.
      await tx.outreachMessage.update({ where: { id: message.id }, data: { sendStatus: "queued_for_pacing" } });
      return { kind: "stop" as const };
    }
    await tx.outreachMessage.update({
      where: { id: message.id },
      data: { sendStatus: "sent", sentAt: new Date(), sentViaAccountId: account.id },
    });
    return {
      kind: "send" as const,
      fromEmail: account.sesFromEmail,
      fromName: account.sesFromName,
      to: lead.contactEmail,
      businessName: lead.businessName,
      accountId: account.id,
    };
  });

  if (prepared.kind === "stop") return;
  if (prepared.kind === "error") {
    await logError({
      source: "outreach.ses.send",
      error: new Error(prepared.message),
      tenantId,
      context: { leadId: message.leadId, messageId: message.id, ...prepared.context },
    });
    return;
  }

  const result = await sendOutreachEmail({
    fromEmail: prepared.fromEmail,
    fromName: prepared.fromName,
    to: prepared.to,
    subject: prepared.businessName ? `Quick note for ${prepared.businessName}` : "Quick note",
    html: (message.editedBody || message.body).replace(/\n/g, "<br />"),
    tenantId,
  });

  if (!result.ok) {
    // Correct the provisional claim -- this send never actually happened,
    // so it must not count toward the cap or show as delivered.
    await withTenant(tenantId, (tx) =>
      tx.outreachMessage.update({ where: { id: message.id }, data: { sendStatus: "failed" } })
    );
  }

  if (result.ok && !result.skipped && result.messageId) {
    // Stash Resend's own message id so the delivery webhook
    // (src/app/api/webhooks/resend/route.ts) can match a later
    // sent/delivered/bounced/complained event back to this row.
    // deliveryStatus starts "sent" (accepted by Resend, no outcome
    // reported yet) -- the webhook advances it from there.
    await withTenant(tenantId, (tx) =>
      tx.outreachMessage.update({
        where: { id: message.id },
        data: { resendMessageId: result.messageId, deliveryStatus: "sent", deliveryStatusAt: new Date() },
      })
    );
  }

  if (result.ok && !result.skipped) {
    // sentCount is the bounce-rate denominator (maybePauseForBounceRate) --
    // incremented here, at the one real send call site, rather than derived
    // by counting outreach_messages rows each time, so a real SES send
    // always has a matching counter bump with no separate query needed to
    // reconstruct it.
    await withTenant(tenantId, async (tx) => {
      await tx.outreachAccount.update({ where: { id: prepared.accountId }, data: { sentCount: { increment: 1 } } });
      await maybePauseForBounceRate(tx, tenantId, prepared.accountId);
    });
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
async function maybePauseForBounceRate(tx: Prisma.TransactionClient, tenantId: string, accountId: string): Promise<void> {
  const account = await tx.outreachAccount.findFirst({ where: { id: accountId, tenantId } });
  if (!account || account.sentCount < BOUNCE_RATE_MIN_SAMPLE) return;

  const bounceRate = account.bounceCount / account.sentCount;
  if (bounceRate <= BOUNCE_RATE_PAUSE_THRESHOLD) return;

  await tx.outreachAccount.update({
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
  // Deliberately platform-scoped: this is the cron entry point, it runs with
  // no tenant session at all and its whole job is to find pending work across
  // EVERY tenant. Each message it finds is then dispatched through
  // sendIfEmailChannel(), which re-enters withTenant() scoped to that
  // message's own tenantId -- so the per-tenant writes below are still
  // tenant-scoped, only this discovery read spans tenants.
  const queued = await withPlatformAccess((tx) =>
    tx.outreachMessage.findMany({
      where: {
        channel: "email",
        OR: [
          { sendStatus: "queued_for_pacing" },
          { sendStatus: "pending", approvalStatus: "approved" },
        ],
      },
      select: { id: true, leadId: true, channel: true, body: true, editedBody: true, tenantId: true },
    })
  );

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

  const message = await withTenant(session.tenantId!, async (tx) => {
    const found = await tx.outreachMessage.findFirst({ where: { id: messageId, tenantId: session.tenantId! } });
    if (!found) return null;
    await tx.outreachMessage.update({
      where: { id: messageId },
      data: { approvalStatus: "approved", approvedById: session.id, approvedAt: new Date() },
    });
    await maybeAdvanceLead(tx, session.tenantId!, found.leadId, session.name ?? session.id);
    return found;
  });
  if (!message) return { ok: false as const, error: "Message not found." };

  // Outside the transaction above on purpose -- it makes a real SES network
  // call and opens its own withTenant scope (see sendIfEmailChannel).
  await sendIfEmailChannel(session.tenantId!, message);

  return { ok: true as const };
}

/**
 * Real gap fixed 2026-09-02: a failed email send used to have NO way back
 * to a sendable state at all -- approveMessageAction() only ever runs
 * sendIfEmailChannel() once, right after the approval itself, and a
 * message that's already "approved" never re-enters that flow again on
 * its own. A tenant hitting a real Resend failure (bad domain, transient
 * API error, etc.) had no button anywhere to try again -- the message just
 * sat "failed" permanently. This re-runs the exact same send path
 * (sendIfEmailChannel, same cap-check/claim/Resend-call logic
 * approveMessageAction already uses) against an existing approved message,
 * without re-approving it (it's already approved -- this only concerns
 * itself with getting the actual send to happen).
 */
export async function retryFailedEmailSendAction(messageId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const message = await withTenant(session.tenantId!, (tx) =>
    tx.outreachMessage.findFirst({ where: { id: messageId, tenantId: session.tenantId! } })
  );
  if (!message) return { ok: false as const, error: "Message not found." };
  if (message.channel !== "email") {
    return { ok: false as const, error: "Retry only applies to email messages." };
  }
  if (message.approvalStatus !== "approved") {
    return { ok: false as const, error: "Only an approved message can be retried." };
  }
  if (message.sendStatus !== "failed") {
    return { ok: false as const, error: "This message hasn't failed -- nothing to retry." };
  }

  await sendIfEmailChannel(session.tenantId!, message);

  return { ok: true as const };
}

export async function holdMessageAction(messageId: string, reason?: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const message = await tx.outreachMessage.findFirst({ where: { id: messageId, tenantId: session.tenantId! } });
    if (!message) return false;
    await tx.outreachMessage.update({
      where: { id: messageId },
      data: { approvalStatus: "held", holdReason: reason || null },
    });
    return true;
  });
  if (!found) return { ok: false as const, error: "Message not found." };

  return { ok: true as const };
}

export async function saveMessageEditAction(messageId: string, editedBody: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const message = await tx.outreachMessage.findFirst({ where: { id: messageId, tenantId: session.tenantId! } });
    if (!message) return false;
    await tx.outreachMessage.update({
      where: { id: messageId },
      data: { editedBody, approvalStatus: "edited" },
    });
    return true;
  });
  if (!found) return { ok: false as const, error: "Message not found." };

  return { ok: true as const };
}

export async function approveAllMessagesAction(messageIds: string[]) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const messages = await withTenant(session.tenantId!, async (tx) => {
    const found = await tx.outreachMessage.findMany({
      where: { id: { in: messageIds }, tenantId: session.tenantId!, approvalStatus: { not: "held" } },
      select: { id: true, leadId: true, channel: true, body: true, editedBody: true },
    });
    if (found.length === 0) return found;

    await tx.outreachMessage.updateMany({
      where: { id: { in: found.map((m) => m.id) } },
      data: { approvalStatus: "approved", approvedById: session.id, approvedAt: new Date() },
    });

    // Sequential rather than the previous Promise.all: these all run against
    // one shared transaction client now, and a Prisma TransactionClient can't
    // have several queries in flight on it concurrently.
    const leadIds = [...new Set(found.map((m) => m.leadId))];
    for (const leadId of leadIds) {
      await maybeAdvanceLead(tx, session.tenantId!, leadId, session.name ?? session.id);
    }
    return found;
  });
  if (messages.length === 0) return { ok: true as const, approvedCount: 0 };

  // Outside the transaction -- real SES sends, each opening its own scope.
  //
  // Sequential, NOT Promise.all. sendIfEmailChannel opens one to three
  // withTenant() scopes per message (the locked cap-check-and-claim, then a
  // correction and/or the sent-counter bump), so mapping it over N approved
  // messages concurrently opened up to 3N real Postgres transactions at
  // once, unbounded by how many messages the operator selected. That is the
  // bug class that crashed the Pipeline page in production -- see
  // src/lib/outreach/leads.ts's getPipelineBoard for the full writeup -- and
  // Approve All is its worst case, since N is user-controlled rather than a
  // fixed 7. Vercel serverless + Supabase's pgbouncer transaction pooler
  // cannot absorb that; local dev could, which is why it never showed here.
  //
  // Concurrency bought nothing anyway: every message for a single account
  // already serialized behind that account's SELECT ... FOR UPDATE row lock,
  // so the sends queued up regardless -- they just each held a pooled
  // connection open while waiting. Matches dispatchPacingQueueAction's
  // existing sequential loop over the same function.
  for (const message of messages) {
    await sendIfEmailChannel(session.tenantId!, message);
  }

  return { ok: true as const, approvedCount: messages.length };
}
