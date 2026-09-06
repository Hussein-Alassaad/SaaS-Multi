"use server";

import { SignJWT } from "jose";
import { withTenant } from "@/lib/db";
import { getTenantSession, getSecretKey } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { revalidatePath } from "next/cache";
import { saveReplyAttachment, AttachmentTooLarge } from "@/lib/outreach/reply-attachments";
import { sendIfEmailChannel } from "@/lib/actions/outreach-approvals";

/**
 * Real gap fixed 2026-09-06, live-verified against a real Instagram DM:
 * a tenant-written Instagram/LinkedIn reply from this page relied entirely
 * on scheduler.py's fast reply-send poll (run_reply_send_cycle(), ~every
 * 2-3 min) to actually deliver it -- which only works if the scheduler is
 * running continuously in production. Per DEPLOY.md's own gate ("do not
 * start the scheduler unsupervised until every channel has a supervised
 * live send confirmed"), it never has been, so a reply just sat at
 * send_status "pending" forever with nothing to pick it up. Email dodges
 * this by calling Resend directly (sendIfEmailChannel) since Next.js can
 * reach it over plain HTTP -- Instagram/LinkedIn need the actual
 * Playwright browser-automation process, which only exists on the
 * droplet, so this calls that same real send right now instead of hoping
 * a background poll is running. Same JWT-minting convention as
 * agentControlAction()/startConnectAccountAction() (jose + AUTH_SECRET,
 * short-lived, purpose-scoped) -- deliberately NOT gated behind the
 * "agent-control" platform permission that action uses, since triggering
 * one's own reply-send is a normal tenant action, not an infra control.
 */
async function sendReplyViaAgent(tenantId: string, leadId: string, messageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const controlHost = process.env.LIVE_LOGIN_WS_HOST;
  if (!controlHost) return { ok: false, error: "Agent control isn't configured on this deployment yet." };

  const token = await new SignJWT({ purpose: "agent_control", action: "send_reply" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(getSecretKey());

  let response: Response;
  try {
    response = await fetch(`https://${controlHost}/control`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send_reply", tenantId, leadId, messageId }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: "Could not reach the agent." };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, error: body?.error ?? `Agent returned HTTP ${response.status}.` };
  return { ok: true };
}

/**
 * "Reply Here" -- lets a tenant read and respond to a lead's real
 * conversation directly from the dashboard, instead of opening
 * LinkedIn/Instagram themselves. Built specifically so the account owner
 * doesn't need to personally log into the connected account to handle
 * replies -- every login from a different location/IP than the agent's own
 * consistent proxy is a real account-flagging risk (see this session's own
 * conversation), so keeping replies inside the platform is the actual fix,
 * not a workaround.
 *
 * Two lists, not one: "replied" (status="replied", confirmed real replies
 * with content to show) and "not yet replied" (status="contacted" -- still
 * only outbound, no reply detected). The second list exists specifically as
 * a manual safety net: outreach/agent/sending/linkedin_reply_check.py's own
 * module docstring flags that its true-positive detection path (a lead
 * ACTUALLY replying) has never been exercised against a real conversation
 * yet -- only the true-negative path is confirmed. If detection ever
 * silently misses a real reply, the lead just sits in "not yet replied"
 * forever with no error -- a human scanning that list against their own
 * LinkedIn/Instagram inbox occasionally is the only thing that would catch
 * that failure mode until detection itself is proven live.
 */

interface ThreadMessage {
  id: string;
  from: "us" | "lead";
  body: string;
  sendStatus: string | null; // only set for "us" messages: "pending" | "sent" | "failed"
  sentAt: string | null;
  createdAt: string;
  attachmentUrl: string | null; // only ever set for "us" messages -- replies we sent
  attachmentKind: string | null; // "image" | "video" | "audio" | "file"
  attachmentName: string | null;
}

export interface ReplyThreadLead {
  id: string;
  businessName: string | null;
  platform: string;
  status: string;
  temperature: string | null;
  profileUrl: string | null;
  contactEmail: string | null;
  lastActivityAt: string;
  messages: ThreadMessage[];
}

export async function getReplyThreadsAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "replies", "view");
  if (!permCheck.ok) return permCheck;

  const leads = await withTenant(session.tenantId!, (tx) =>
    tx.outreachLead.findMany({
      where: {
        tenantId: session.tenantId!,
        status: { in: ["contacted", "replied", "interested", "meeting_booked"] },
      },
      select: {
        id: true,
        businessName: true,
        platform: true,
        status: true,
        temperature: true,
        profileUrl: true,
        contactEmail: true,
        updatedAt: true,
        messages: {
          where: { sendStatus: { in: ["sent", "pending", "failed"] } },
          select: {
            id: true, body: true, editedBody: true, isReply: true, sendStatus: true, sentAt: true, createdAt: true,
            attachmentUrl: true, attachmentKind: true, attachmentName: true,
          },
          orderBy: { createdAt: "asc" },
        },
        replies: {
          select: { id: true, body: true, repliedAt: true },
          orderBy: { repliedAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    })
  );

  const threads: ReplyThreadLead[] = leads.map((lead) => {
    const outbound: ThreadMessage[] = lead.messages.map((m) => ({
      id: m.id,
      from: "us" as const,
      body: m.editedBody ?? m.body,
      sendStatus: m.sendStatus,
      sentAt: m.sentAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      attachmentUrl: m.attachmentUrl,
      attachmentKind: m.attachmentKind,
      attachmentName: m.attachmentName,
    }));
    const inbound: ThreadMessage[] = lead.replies.map((r) => ({
      id: r.id,
      from: "lead" as const,
      body: r.body,
      sendStatus: null,
      sentAt: null,
      createdAt: r.repliedAt.toISOString(),
      attachmentUrl: null,
      attachmentKind: null,
      attachmentName: null,
    }));
    const messages = [...outbound, ...inbound].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    return {
      id: lead.id,
      businessName: lead.businessName,
      platform: lead.platform,
      status: lead.status,
      temperature: lead.temperature,
      profileUrl: lead.profileUrl,
      contactEmail: lead.contactEmail,
      lastActivityAt: lead.updatedAt.toISOString(),
      messages,
    };
  });

  const replied = threads.filter((t) => t.status !== "contacted");
  const notReplied = threads.filter((t) => t.status === "contacted");

  return { ok: true as const, replied, notReplied };
}

/**
 * Sends a tenant-written reply. Creates it pre-approved (typing it and
 * hitting Send IS the approval, no separate review step -- this is a human
 * responding to another human, not agent-generated cold outreach) and
 * tagged isReply=true so the Python send-side delivers it INTO the
 * existing conversation thread rather than as a fresh connection request.
 * Picked up by scheduler.py's fast reply-send poll (~every 2-3 min) for
 * linkedin/instagram/whatsapp -- that poll explicitly excludes email
 * (repo.replies_pending() only queries those three channels, see
 * run_reply_send_cycle()'s own docstring), so an email reply is sent
 * directly from here via sendIfEmailChannel() instead, the same real
 * Resend call (with the same daily-cap/pause/do-not-contact guards)
 * outreach-approvals.ts already uses for approved outbound messages.
 * Real gap fixed 2026-09-05: before this, a typed reply to an email lead
 * sat at sendStatus "pending" forever -- nothing was ever going to pick
 * it up.
 */
/**
 * `attachment` is optional -- a reply can be text-only (the common case),
 * attachment-only (e.g. a voice note with nothing typed), or both. At
 * least one of body/attachment is required; sending neither is rejected.
 * File uploads to Vercel Blob (src/lib/outreach/reply-attachments.ts) --
 * NOT src/lib/storage.ts's local-disk save, which doesn't survive Vercel's
 * serverless filesystem. Next.js server actions accept a File argument
 * directly from a client component call (no <form>/FormData needed), so
 * RepliesClient just passes the File straight through.
 */
export async function sendReplyAction(leadId: string, body: string, attachment?: File | null) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "replies", "edit");
  if (!permCheck.ok) return permCheck;

  const trimmed = body.trim();
  if (!trimmed && !attachment) return { ok: false as const, error: "Reply can't be empty." };

  const lead = await withTenant(session.tenantId!, (tx) =>
    tx.outreachLead.findFirst({
      where: { id: leadId, tenantId: session.tenantId! },
      select: { id: true, platform: true, doNotContact: true, accountId: true },
    })
  );
  if (!lead) return { ok: false as const, error: "Lead not found." };
  if (lead.doNotContact) return { ok: false as const, error: "This lead is marked Do Not Contact." };

  let attachmentData: { url: string; kind: string; name: string } | null = null;
  if (attachment && attachment.size > 0) {
    try {
      attachmentData = await saveReplyAttachment(session.tenantId!, leadId, attachment);
    } catch (err) {
      const message = err instanceof AttachmentTooLarge ? err.message : "Couldn't upload attachment.";
      return { ok: false as const, error: message };
    }
  }

  // Deliberately a second withTenant block, not one wrapping the whole action:
  // saveReplyAttachment() above is a network upload to Vercel Blob, and holding
  // a Postgres transaction open across it would pin a pooled connection for the
  // duration of the upload.
  const message = await withTenant(session.tenantId!, (tx) =>
    tx.outreachMessage.create({
      data: {
        tenantId: session.tenantId!,
        leadId,
        channel: lead.platform,
        body: trimmed,
        isReply: true,
        attachmentUrl: attachmentData?.url ?? null,
        attachmentKind: attachmentData?.kind ?? null,
        attachmentName: attachmentData?.name ?? null,
        approvalStatus: "approved",
        approvedById: session.id,
        approvedAt: new Date(),
        sendStatus: "pending",
        sentViaAccountId: lead.accountId,
      },
    })
  );

  if (lead.platform === "email") {
    await sendIfEmailChannel(session.tenantId!, {
      id: message.id,
      leadId,
      channel: "email",
      body: message.body,
      editedBody: null,
      isReply: true,
    });
  } else if (lead.platform === "instagram" || lead.platform === "linkedin") {
    const result = await sendReplyViaAgent(session.tenantId!, leadId, message.id);
    if (!result.ok) {
      // Don't fail the whole action -- the message is saved and will still
      // be picked up by scheduler.py's reply-send poll if/when that's
      // running, same fallback path this had before today. Surface the
      // agent error so a stuck reply isn't silently unexplained.
      return { ok: true as const, messageId: message.id, agentWarning: result.error };
    }
  }

  revalidatePath("/outreach/replies");
  return { ok: true as const, messageId: message.id };
}
