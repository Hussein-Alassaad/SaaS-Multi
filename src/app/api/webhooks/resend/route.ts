import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { withPlatformAccess, withTenant } from "@/lib/db";
import { logError } from "@/lib/error-log";

/**
 * Receives Resend's real delivery-lifecycle events (email.sent,
 * email.delivered, email.bounced, email.complained, email.delivery_delayed)
 * and stores the latest one on the OutreachMessage row that sent it, so the
 * Outreach dashboard can show real per-email delivery status instead of
 * only "our API call to Resend succeeded" (see OutreachMessage.sendStatus,
 * a different, narrower thing -- see schema's own field comments).
 *
 * Replaces src/app/api/webhooks/ses-bounce/route.ts's role for the
 * OutreachAccount.bounceCount safety check too, now that sending runs
 * through Resend, not SES -- that route is AWS-SNS-shaped and receives
 * nothing real anymore since the SES->Resend swap earlier this session.
 *
 * SETUP REQUIRED (not done by this code -- a Resend dashboard step outside
 * this repo): Resend dashboard -> Webhooks -> Add Endpoint -> this route's
 * full URL (https://<domain>/api/webhooks/resend), select the email.*
 * events listed above, copy the generated signing secret into
 * RESEND_WEBHOOK_SECRET. Until that's done, this route still verifies
 * (and rejects) any request, since RESEND_WEBHOOK_SECRET being unset makes
 * the Webhook constructor below throw -- fails closed, not open.
 *
 * SECURITY: Resend signs every webhook payload via Svix, verified below
 * before anything in the body is trusted -- this endpoint is publicly
 * reachable by design (Resend can't authenticate any other way), so an
 * unverified payload would let anyone mark any message "delivered" or
 * "bounced" by POSTing a fake event. Never skip this check.
 */

interface ResendWebhookEvent {
  type:
    | "email.sent"
    | "email.delivered"
    | "email.delivery_delayed"
    | "email.bounced"
    | "email.complained"
    | "email.opened"
    | "email.clicked"
    | string;
  data: { email_id: string };
}

// Only these advance deliveryStatus -- opened/clicked are tracking-pixel/
// link-click events Resend also emits, not delivery outcomes, and are
// deliberately not modeled here (nothing in this app reads them yet).
const DELIVERY_STATUS_BY_EVENT: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error("resend webhook: RESEND_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  let event: ResendWebhookEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(rawBody, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as ResendWebhookEvent;
  } catch (err) {
    // Same posture as ses-bounce's signature-check failure: not logged via
    // logError (no tenant context, and an invalid signature is exactly
    // what an attacker probing this endpoint would produce).
    console.error("resend webhook: signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const deliveryStatus = DELIVERY_STATUS_BY_EVENT[event.type];
  if (!deliveryStatus) {
    return NextResponse.json({ ok: true }); // an event type we don't track (e.g. opened/clicked) -- not an error
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    return NextResponse.json({ ok: true });
  }

  // Platform-scoped by necessity, same reasoning as ses-bounce's own
  // lookup: this is a public, unauthenticated webhook with no session, and
  // it cannot know which tenant this belongs to until it finds the
  // message that produced it -- the lookup itself is what resolves the
  // tenant. The signature check above is what gates this; the actual
  // write below is scoped per tenant via withTenant.
  const message = await withPlatformAccess((tx) =>
    tx.outreachMessage.findFirst({
      where: { resendMessageId: emailId },
      select: { id: true, tenantId: true, sentViaAccountId: true },
    })
  );

  if (!message) {
    // A delivery event for an email this app has no record of sending --
    // Resend accounts can be shared infra-wide; not necessarily an error.
    return NextResponse.json({ ok: true });
  }

  try {
    await withTenant(message.tenantId, async (tx) => {
      await tx.outreachMessage.update({
        where: { id: message.id },
        data: { deliveryStatus, deliveryStatusAt: new Date() },
      });

      // Mirrors ses-bounce's bounceCount safety-check bump: only a real,
      // permanent delivery failure (bounce or spam complaint) counts
      // toward the pause threshold -- delivery_delayed is transient and
      // expected at some background rate, not a list-quality problem.
      if ((deliveryStatus === "bounced" || deliveryStatus === "complained") && message.sentViaAccountId) {
        await tx.outreachAccount.update({
          where: { id: message.sentViaAccountId },
          data: { bounceCount: { increment: 1 } },
        });
      }
    });
  } catch (err) {
    await logError({
      source: "outreach.resend.delivery_webhook",
      error: err,
      context: { messageId: message.id, eventType: event.type },
    });
    return NextResponse.json({ error: "Failed to record delivery status" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
