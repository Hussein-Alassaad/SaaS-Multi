import { NextRequest, NextResponse } from "next/server";
import { withPlatformAccess, withTenant } from "@/lib/db";
import { logError } from "@/lib/error-log";
import { safeCompare } from "@/lib/safe-compare";

/**
 * Real gap fixed 2026-09-02: email had NO reply detection at all, unlike
 * LinkedIn/Instagram (agent/sending/linkedin_reply_check.py,
 * instagram_reply_check.py, both wired into the Python agent's daily
 * cycle) -- a client's email reply only ever landed in whatever real
 * mailbox actually receives mail for the sending domain, invisible to
 * this dashboard. Fixed the same way discovery-side reply handling
 * already works (mirrors agent/crm/reply_detection.py's
 * handle_reply_detected(): insert into outreach_replies, move the lead to
 * "replied", cancel any pending follow-up) -- just triggered from an
 * inbound-email webhook instead of a browser-scrape poll.
 *
 * SOURCE: a Cloudflare Email Routing "Send to a Worker" rule on the
 * receiving domain (partnersinsurancelb.cc or whichever domain a tenant's
 * email account actually receives at) -- Cloudflare Email Routing itself
 * cannot POST a webhook directly, so a small Cloudflare Worker is the
 * real bridge: it receives the raw inbound email via Cloudflare's
 * EmailEvent, parses From/Subject/text body, and POSTs that here as JSON.
 * See DEPLOY.md / this route's own SETUP section below for the exact
 * Worker code and Cloudflare-side routing rule -- that half needs
 * Cloudflare account access this app doesn't have, so it's a manual step
 * outside this repo, same posture as the Resend webhook's own dashboard
 * setup step.
 *
 * SECURITY: shared-secret header (EMAIL_REPLY_WEBHOOK_SECRET), NOT Svix
 * signature verification like the Resend webhook -- Cloudflare Workers
 * don't sign outbound requests the way Resend does, so the Worker itself
 * must be configured to send this exact secret as a header (see the
 * Worker code below). Fails closed: unset secret or a mismatched header
 * both reject the request outright, same posture as the Resend webhook
 * when RESEND_WEBHOOK_SECRET is unset.
 */

interface InboundEmailPayload {
  from: string; // the lead's own email address -- what we match against OutreachLead.contactEmail
  subject?: string;
  text: string; // plain-text body (the Worker strips HTML down to text before POSTing)
}

export async function POST(req: NextRequest) {
  const secret = process.env.EMAIL_REPLY_WEBHOOK_SECRET;
  if (!secret) {
    console.error("email-reply webhook: EMAIL_REPLY_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (!safeCompare(req.headers.get("x-webhook-secret") ?? "", secret)) {
    console.error("email-reply webhook: secret mismatch");
    return NextResponse.json({ error: "Invalid secret" }, { status: 400 });
  }

  let payload: InboundEmailPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fromEmail = payload.from?.trim().toLowerCase();
  if (!fromEmail) {
    return NextResponse.json({ error: "Missing from address" }, { status: 400 });
  }

  // Platform-scoped by necessity, same reasoning as the Resend webhook's
  // own lookup: this is a public, unauthenticated (secret-gated, not
  // session-gated) endpoint with no tenant context until the matching
  // lead is found -- the lookup itself is what resolves the tenant.
  const lead = await withPlatformAccess((tx) =>
    tx.outreachLead.findFirst({
      where: { platform: "email", contactEmail: { equals: fromEmail, mode: "insensitive" } },
      select: { id: true, tenantId: true, accountId: true, status: true },
    })
  );

  if (!lead) {
    // A reply from an address we have no lead record for -- not
    // necessarily an error (could be a stray auto-reply, or someone
    // replying from a different address than the one contacted).
    return NextResponse.json({ ok: true, matched: false });
  }

  const repliedAt = new Date();
  const body = payload.text || "(no text body)";

  // Idempotency guard, found missing in the 2026-09-09 platform review: the
  // Worker (outside this repo, see this route's own SETUP docs) has no
  // retry/backoff logic documented, and any ordinary network blip (a
  // timeout, a non-2xx response, Cloudflare's own retry behavior) resends
  // the exact same payload. Without this, a retry created a duplicate
  // OutreachReply row AND re-ran the lead-status/follow-up-cancellation
  // side effects below on every retry. No message-id is available from the
  // Worker's payload to dedup on directly (see InboundEmailPayload above --
  // adding one needs a Worker-side change outside this repo's control), so
  // this matches on the same lead + same body text within a short window,
  // which is exactly what a genuine retry of the same inbound email looks
  // like -- a real second reply with coincidentally identical text inside
  // the same few seconds is not a realistic case to protect against here.
  const DEDUP_WINDOW_MS = 5 * 60_000;
  const isDuplicate = await withTenant(lead.tenantId, (tx) =>
    tx.outreachReply.findFirst({
      where: {
        leadId: lead.id,
        body,
        repliedAt: { gte: new Date(repliedAt.getTime() - DEDUP_WINDOW_MS) },
      },
      select: { id: true },
    })
  );
  if (isDuplicate) {
    return NextResponse.json({ ok: true, matched: true, duplicate: true });
  }

  try {
    await withTenant(lead.tenantId, async (tx) => {
      await tx.outreachReply.create({
        data: {
          tenantId: lead.tenantId,
          leadId: lead.id,
          accountId: lead.accountId,
          channel: "email",
          body,
          repliedAt,
        },
      });
      // Mirrors agent/crm/reply_detection.py's handle_reply_detected():
      // advance the lead to "replied" and cancel anything still scheduled.
      await tx.outreachLead.update({ where: { id: lead.id }, data: { status: "replied" } });
      await tx.outreachFollowUp.updateMany({
        where: { leadId: lead.id, status: "scheduled" },
        data: { status: "cancelled" },
      });
    });
  } catch (err) {
    await logError({
      source: "outreach.email_reply_webhook",
      error: err,
      tenantId: lead.tenantId,
      context: { leadId: lead.id, fromEmail },
    });
    return NextResponse.json({ error: "Failed to record reply" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, matched: true });
}
