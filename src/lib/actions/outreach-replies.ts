"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { revalidatePath } from "next/cache";

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

  const leads = await db.outreachLead.findMany({
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
        select: { id: true, body: true, editedBody: true, isReply: true, sendStatus: true, sentAt: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      replies: {
        select: { id: true, body: true, repliedAt: true },
        orderBy: { repliedAt: "asc" },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const threads: ReplyThreadLead[] = leads.map((lead) => {
    const outbound: ThreadMessage[] = lead.messages.map((m) => ({
      id: m.id,
      from: "us" as const,
      body: m.editedBody ?? m.body,
      sendStatus: m.sendStatus,
      sentAt: m.sentAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
    }));
    const inbound: ThreadMessage[] = lead.replies.map((r) => ({
      id: r.id,
      from: "lead" as const,
      body: r.body,
      sendStatus: null,
      sentAt: null,
      createdAt: r.repliedAt.toISOString(),
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
 * Picked up by scheduler.py's fast reply-send poll (~every 2-3 min), not
 * the normal once-daily full cycle, since a reply should feel close to
 * real-time -- see that function's own docstring.
 */
export async function sendReplyAction(leadId: string, body: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "replies", "edit");
  if (!permCheck.ok) return permCheck;

  const trimmed = body.trim();
  if (!trimmed) return { ok: false as const, error: "Reply can't be empty." };

  const lead = await db.outreachLead.findFirst({
    where: { id: leadId, tenantId: session.tenantId! },
    select: { id: true, platform: true, doNotContact: true, accountId: true },
  });
  if (!lead) return { ok: false as const, error: "Lead not found." };
  if (lead.doNotContact) return { ok: false as const, error: "This lead is marked Do Not Contact." };

  const message = await db.outreachMessage.create({
    data: {
      tenantId: session.tenantId!,
      leadId,
      channel: lead.platform,
      body: trimmed,
      isReply: true,
      approvalStatus: "approved",
      approvedById: session.id,
      approvedAt: new Date(),
      sendStatus: "pending",
      sentViaAccountId: lead.accountId,
    },
  });

  revalidatePath("/outreach/replies");
  return { ok: true as const, messageId: message.id };
}
