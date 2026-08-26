"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";

export async function saveLeadNotesAction(leadId: string, notes: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "leads", "edit");
  if (!permCheck.ok) return permCheck;

  const lead = await db.outreachLead.findFirst({ where: { id: leadId, tenantId: session.tenantId! } });
  if (!lead) return { ok: false as const, error: "Lead not found." };

  await db.outreachLead.update({ where: { id: leadId }, data: { notes } });
  return { ok: true as const };
}

/**
 * Toggles a lead's permanent opt-out flag -- checked as a hard stop before
 * every real send, on every channel (src/lib/actions/outreach-approvals.ts's
 * sendIfEmailChannel() for email, outreach/agent/db/repositories.py's
 * messages_approved_pending() for LinkedIn/Instagram). Independent of the
 * lead's pipeline `status` -- a lead can be do-not-contact at any stage.
 */
export async function setDoNotContactAction(leadId: string, doNotContact: boolean, reason?: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "leads", "edit");
  if (!permCheck.ok) return permCheck;

  const lead = await db.outreachLead.findFirst({ where: { id: leadId, tenantId: session.tenantId! } });
  if (!lead) return { ok: false as const, error: "Lead not found." };

  await db.outreachLead.update({
    where: { id: leadId },
    data: {
      doNotContact,
      doNotContactReason: doNotContact ? (reason?.trim() || null) : null,
    },
  });

  return { ok: true as const };
}

export async function scheduleFollowUpAction(leadId: string, enabled: boolean, scheduledFor: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "leads", "edit");
  if (!permCheck.ok) return permCheck;

  const lead = await db.outreachLead.findFirst({ where: { id: leadId, tenantId: session.tenantId! } });
  if (!lead) return { ok: false as const, error: "Lead not found." };

  const settings = await db.outreachSettings.findUnique({ where: { tenantId: session.tenantId! } });
  const maxContacts = settings?.maxContactsPerLead ?? 2;
  if (lead.contactCount >= maxContacts) {
    return { ok: false as const, error: `Already at max contacts (${maxContacts})` };
  }

  await db.outreachFollowUp.create({
    data: {
      tenantId: session.tenantId!,
      leadId,
      enabled,
      scheduledFor: new Date(scheduledFor),
      status: "scheduled",
    },
  });

  return { ok: true as const };
}
