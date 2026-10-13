"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { revalidatePath } from "next/cache";

/**
 * Bulk follow-up: 2026-09-02, real feature requested by the platform
 * owner -- a dashboard section listing every lead that was messaged and
 * hasn't replied, with one button to follow up all of them at once. Same
 * "contacted" = not-yet-replied definition outreach-replies.ts's
 * getReplyThreadsAction() already established (status flips to "replied"
 * the instant a reply is detected -- see agent/crm/reply_detection.py's
 * handle_reply_detected()).
 *
 * This action does NOT generate the follow-up message text itself --
 * message generation only exists in the Python agent (agent/messaging/
 * generate.py calls Claude directly; nothing on the Next.js side does),
 * so there is no way to produce real follow-up text from here. Instead
 * this schedules an immediate, due-now follow-up row for every eligible
 * lead (agent/crm/followup.py's own schema/shape), which the agent's
 * existing dispatch_due_followups() picks up on its next run and turns
 * into a real generated message queued for approval -- same approval gate
 * every other message goes through, nothing here auto-sends anything.
 *
 * Explicit instruction from the platform owner: this bulk action ignores
 * settings.max_contacts_per_lead entirely (a lead already at the cap is
 * still scheduled) -- a deliberate override for this one action, not a
 * change to the cap itself (schedule_followup()'s normal per-lead path in
 * the Python agent still enforces it as before).
 */

export interface FollowUpLead {
  id: string;
  businessName: string | null;
  platform: string;
  contactCount: number;
  firstContactedAt: string | null;
  score: number | null;
  temperature: string | null;
  /** How many follow-up messages have actually been SENT to this lead. 0 = never followed up. */
  followUpsSent: number;
  lastFollowUpAt: string | null;
  /** A follow-up is scheduled, or written and waiting for approval/sending -- not sent yet. */
  followUpInProgress: boolean;
}

export async function getNotRepliedLeadsAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "leads", "view");
  if (!permCheck.ok) return permCheck;

  const leads = await withTenant(session.tenantId!, (tx) =>
    tx.outreachLead.findMany({
      where: {
        tenantId: session.tenantId!,
        status: "contacted",
        doNotContact: false,
        // Instagram is the only live outreach channel (LinkedIn and email are switched off), so only Instagram leads can be followed up.
        platform: "instagram",
      },
      select: {
        id: true,
        businessName: true,
        platform: true,
        contactCount: true,
        firstContactedAt: true,
        score: true,
        temperature: true,
        messages: {
          where: { isFollowup: true, isReply: false },
          select: { sendStatus: true, sentAt: true, approvalStatus: true },
        },
        followUps: { where: { status: "scheduled" }, select: { id: true } },
      },
      orderBy: { firstContactedAt: "asc" },
    })
  );

  const all: FollowUpLead[] = leads.map((l) => {
    const sent = l.messages.filter((m) => m.sendStatus === "sent");
    const lastSent = sent.map((m) => m.sentAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    const waiting = l.messages.some((m) => !["sent", "failed"].includes(m.sendStatus) && m.approvalStatus !== "rejected");
    return {
      id: l.id,
      businessName: l.businessName,
      platform: l.platform,
      contactCount: l.contactCount,
      firstContactedAt: l.firstContactedAt?.toISOString() ?? null,
      score: l.score,
      temperature: l.temperature,
      followUpsSent: sent.length,
      lastFollowUpAt: lastSent?.toISOString() ?? null,
      followUpInProgress: waiting || l.followUps.length > 0,
    };
  });

  // The Follow Up page shows leads we have never followed up; the ones already followed up once live in their own tab.
  return {
    ok: true as const,
    leads: all.filter((l) => l.followUpsSent === 0),
    followedUp: all.filter((l) => l.followUpsSent > 0).sort((a, b) => (b.lastFollowUpAt ?? "").localeCompare(a.lastFollowUpAt ?? "")),
  };
}

/**
 * Owner-requested 2026-09-15: a simple box on the Follow-ups page for
 * what the agent's follow-up messages should be about, applied to every
 * follow-up for this tenant (not per-lead) -- the smallest possible
 * version of "let me influence the follow-up content" the owner actually
 * asked for, deliberately NOT a full review/approval workflow around it.
 *
 * This does NOT replace AI generation with a fixed template -- the agent
 * (agent/messaging/generate.py's generate_followup_message()) still
 * writes a fresh, distinct message every time (never repeats the
 * original pitch verbatim, per _FOLLOWUP_RULES), this text is passed in
 * as extra guidance alongside the original sent message. Empty string
 * means "no guidance", follow-ups generate exactly as before this field
 * existed.
 */
export async function getFollowUpGuidanceAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "leads", "view");
  if (!permCheck.ok) return permCheck;

  const settings = await withTenant(session.tenantId!, (tx) =>
    tx.outreachSettings.findUnique({
      where: { tenantId: session.tenantId! },
      select: { followUpGuidance: true },
    })
  );

  return { ok: true as const, guidance: settings?.followUpGuidance ?? "" };
}

export async function setFollowUpGuidanceAction(guidance: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "leads", "edit");
  if (!permCheck.ok) return permCheck;

  await withTenant(session.tenantId!, (tx) =>
    tx.outreachSettings.update({
      where: { tenantId: session.tenantId! },
      data: { followUpGuidance: guidance.trim().slice(0, 2000) },
    })
  );

  revalidatePath("/outreach/followups");
  return { ok: true as const };
}

export async function followUpAllAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "leads", "edit");
  if (!permCheck.ok) return permCheck;

  const result = await withTenant(session.tenantId!, async (tx) => {
    const leads = await tx.outreachLead.findMany({
      where: {
        tenantId: session.tenantId!,
        status: "contacted",
        doNotContact: false,
        // Instagram is the only live outreach channel (LinkedIn and email are
        // switched off), and a lead that already has a scheduled follow-up must
        // not get a second one: pressing the button twice used to create one
        // row per lead per press, i.e. two follow-up messages per lead.
        platform: "instagram",
        followUps: { none: { status: "scheduled" } },
        // Only leads we have never followed up: one already followed up once is not pushed again by this button.
        messages: { none: { isFollowup: true, isReply: false, sendStatus: "sent" } },
      },
      select: { id: true },
    });
    if (leads.length === 0) return { scheduled: 0 };

    const now = new Date();
    // createMany rather than one insert per lead -- this can be a real
    // batch (every non-replier at once), one round-trip beats N.
    // skipDuplicates isn't relevant here (no unique constraint this could
    // violate), included only for the (unlikely) case of a stale row from
    // a previous click still sitting "scheduled" for the same lead.
    await tx.outreachFollowUp.createMany({
      data: leads.map((l) => ({
        tenantId: session.tenantId!,
        leadId: l.id,
        enabled: true,
        scheduledFor: now,
        isReengagement: false,
        status: "scheduled",
      })),
    });
    return { scheduled: leads.length };
  });

  revalidatePath("/outreach/followups");
  return { ok: true as const, scheduled: result.scheduled };
}
