import { NextRequest, NextResponse } from "next/server";
import MessageValidator from "sns-validator";
import { withTenant, withPlatformAccess } from "@/lib/db";
import { logError } from "@/lib/error-log";

/**
 * DEPRECATED 2026-08-29 -- SES was replaced by Resend for Outreach email
 * sending earlier this session (see src/lib/outreach/resend-email.ts's own
 * docstring for why). This route is AWS-SNS-shaped and receives nothing
 * real anymore; src/app/api/webhooks/resend/route.ts is the live
 * replacement (Svix-signed, Resend's own event shape) and now owns
 * bounceCount updates too. Left in place, unregistered anywhere in AWS,
 * rather than deleted -- no SNS subscription points at it, so it is dead
 * code, not a live attack surface; safe to remove outright in a later
 * cleanup pass once confirmed nothing references it.
 *
 * Receives Amazon SES bounce/complaint notifications via SNS, so
 * OutreachAccount.bounceCount stays accurate for the bounce-rate safety
 * check in src/lib/actions/outreach-approvals.ts's maybePauseForBounceRate().
 *
 * SETUP REQUIRED (not done by this code -- an AWS console/CLI step outside
 * this repo): an SES configuration set with an SNS destination for Bounce
 * and Complaint events, subscribed to this route's full URL
 * (https://<domain>/api/webhooks/ses-bounce), and src/lib/outreach/ses.ts's
 * SendEmailCommand needs a `ConfigurationSetName` matching that set --
 * neither of which exists yet. Until that's wired up, bounceCount simply
 * never increments and the safety check is a no-op (fails open, not
 * closed) -- flagged here rather than silently assumed configured.
 *
 * SECURITY: SNS message signatures are verified via sns-validator (AWS's
 * own maintained package) before anything in the payload is trusted --
 * this endpoint is publicly reachable by design (SNS can't authenticate any
 * other way), so an unverified payload would let anyone pause any tenant's
 * email sending by POSTing a fake high-bounce-rate notification. Never skip
 * this check to "simplify" the handler.
 */

const validator = new MessageValidator();

function validateMessage(body: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (err) {
      reject(err);
      return;
    }
    validator.validate(parsed as Parameters<MessageValidator["validate"]>[0], (err, message) => {
      if (err) reject(err);
      else resolve(message as Record<string, unknown>);
    });
  });
}

interface SesBounceNotification {
  notificationType: "Bounce" | "Complaint" | "Delivery";
  mail: { messageId: string; destination: string[] };
  bounce?: { bounceType: string; bouncedRecipients: { emailAddress: string }[] };
  complaint?: { complainedRecipients: { emailAddress: string }[] };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  let snsMessage: Record<string, unknown>;
  try {
    snsMessage = await validateMessage(rawBody);
  } catch (err) {
    // Not logged via logError (no tenant context established yet, and an
    // invalid signature is exactly the kind of thing that could be spammed
    // by an attacker -- flooding the error log on every attempt isn't
    // useful). A 400 is enough; SNS itself will retry legitimate
    // deliveries that failed for transient reasons.
    console.error("ses-bounce webhook: SNS signature validation failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const type = snsMessage.Type as string | undefined;

  // SNS's subscription handshake -- arrives once, when the topic
  // subscription is first created in the AWS console/CLI. Auto-confirming
  // means the subscription setup step doesn't need a human to manually
  // fetch and visit a confirmation URL.
  if (type === "SubscriptionConfirmation") {
    const subscribeUrl = snsMessage.SubscribeURL as string | undefined;
    if (subscribeUrl) {
      try {
        await fetch(subscribeUrl);
      } catch (err) {
        console.error("ses-bounce webhook: failed to auto-confirm SNS subscription", err);
        return NextResponse.json({ error: "Subscription confirmation failed" }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true });
  }

  if (type !== "Notification") {
    return NextResponse.json({ ok: true }); // unrecognized SNS message type -- not an error, just nothing to do
  }

  let ses: SesBounceNotification;
  try {
    ses = JSON.parse(snsMessage.Message as string);
  } catch (err) {
    console.error("ses-bounce webhook: malformed SES notification JSON", err);
    return NextResponse.json({ error: "Malformed notification" }, { status: 400 });
  }

  if (ses.notificationType !== "Bounce" && ses.notificationType !== "Complaint") {
    return NextResponse.json({ ok: true }); // Delivery notifications don't affect bounceCount
  }

  // Hard/permanent bounces (invalid address) are what actually damage
  // sender reputation -- SES also reports soft/transient bounces
  // (mailbox full, temporary server issue) under bounceType "Transient",
  // which are normal and expected at some background rate, not a list-
  // quality problem. Only Permanent bounces (and complaints, which are
  // always serious regardless of type) count toward the safety threshold.
  const isPermanentBounce = ses.bounce?.bounceType === "Permanent";
  const isComplaint = ses.notificationType === "Complaint";
  if (!isPermanentBounce && !isComplaint) {
    return NextResponse.json({ ok: true });
  }

  const recipientEmails = isComplaint
    ? (ses.complaint?.complainedRecipients ?? []).map((r) => r.emailAddress)
    : (ses.bounce?.bouncedRecipients ?? []).map((r) => r.emailAddress);

  if (recipientEmails.length === 0) {
    return NextResponse.json({ ok: true });
  }

  // Find which OutreachAccount actually sent this -- via the OutreachMessage
  // row already recorded at send time (sentViaAccountId), matched on the
  // recipient's lead.contactEmail rather than trusting SES's `mail.source`
  // (which is the From address, not useful for finding the sending
  // account when a tenant could theoretically have multiple email accounts
  // sharing one verified domain).
  // Platform-scoped by necessity: this is a public, unauthenticated SNS
  // endpoint with no session, and it cannot know which tenant a bounce
  // belongs to until it finds the message that produced it -- the lookup
  // itself is what resolves the tenant. The signature check above is what
  // gates this; the per-account writes below are scoped per tenant.
  const affectedMessages = await withPlatformAccess((tx) =>
    tx.outreachMessage.findMany({
      where: {
        channel: "email",
        sendStatus: "sent",
        lead: { contactEmail: { in: recipientEmails } },
      },
      select: { tenantId: true, sentViaAccountId: true },
    })
  );

  // Group the affected accounts by their owning tenant so each increment
  // runs under that tenant's own RLS context rather than one blanket
  // platform-wide write.
  const accountsByTenant = new Map<string, Set<string>>();
  for (const m of affectedMessages) {
    if (!m.sentViaAccountId) continue;
    let set = accountsByTenant.get(m.tenantId);
    if (!set) {
      set = new Set<string>();
      accountsByTenant.set(m.tenantId, set);
    }
    set.add(m.sentViaAccountId);
  }
  const accountIds = [...new Set(affectedMessages.map((m) => m.sentViaAccountId).filter((id): id is string => !!id))];
  if (accountIds.length === 0) {
    // A bounce for an email this app has no record of sending -- SES
    // config sets can be shared infra-wide; not every notification is
    // necessarily ours. Not an error.
    return NextResponse.json({ ok: true });
  }

  try {
    for (const [tenantId, ids] of accountsByTenant) {
      await withTenant(tenantId, (tx) =>
        tx.outreachAccount.updateMany({
          where: { id: { in: [...ids] } },
          data: { bounceCount: { increment: 1 } },
        })
      );
    }
  } catch (err) {
    await logError({
      source: "outreach.ses.bounce_webhook",
      error: err,
      context: { accountIds, notificationType: ses.notificationType },
    });
    return NextResponse.json({ error: "Failed to record bounce" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
