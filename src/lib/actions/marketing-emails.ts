"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";

/**
 * "Sent emails" here means real outbound Message rows sent through a
 * connected GMAIL/OUTLOOK channel (see Channel.oauthEmail) -- there is no
 * separate campaign-sending system in Marketing today, so this reads the
 * same Message/Conversation data the Live Inbox already uses rather than
 * inventing a parallel "campaign" concept. Open/click tracking does not
 * exist for these sends (no tracking pixel/webhook is wired up), so this
 * deliberately does not fabricate open-rate/click-rate numbers.
 */
export async function listSentEmailsAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "emails", "view");
  if (!permCheck.ok) return permCheck;

  const messages = await withTenant(session.tenantId!, (tx) =>
    tx.message.findMany({
      where: {
        conversation: {
          tenantId: session.tenantId!,
          channel: { provider: { in: ["GMAIL", "OUTLOOK"] } },
        },
        sender: { in: ["AI", "HUMAN"] },
        status: { in: ["SENT", "APPROVED"] },
      },
      include: {
        conversation: {
          include: { nexarisClient: true, channel: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
  );

  return {
    ok: true as const,
    emails: messages.map((m) => ({
      id: m.id,
      subjectPreview: m.body.slice(0, 80),
      recipient: m.conversation.nexarisClient.email ?? m.conversation.nexarisClient.name ?? "Unknown",
      channel: m.conversation.channel.provider,
      fromMailbox: m.conversation.channel.oauthEmail,
      sentAt: m.createdAt.toISOString(),
    })),
  };
}

export async function listEmailTemplatesAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "emails", "view");
  if (!permCheck.ok) return permCheck;

  const templates = await withTenant(session.tenantId!, (tx) =>
    tx.emailTemplate.findMany({ where: { tenantId: session.tenantId! }, orderBy: { updatedAt: "desc" } })
  );

  return { ok: true as const, templates };
}

export interface EmailTemplateInput {
  name: string;
  subject: string;
  body: string;
}

export async function createEmailTemplateAction(input: EmailTemplateInput) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "emails", "create");
  if (!permCheck.ok) return permCheck;

  const name = input.name.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!name || !subject || !body) return { ok: false as const, error: "Name, subject, and body are required." };

  const created = await withTenant(session.tenantId!, (tx) =>
    tx.emailTemplate.create({
      data: { tenantId: session.tenantId!, name, subject, body, createdById: session.id },
    })
  );

  revalidatePath("/agency/emails");
  return { ok: true as const, template: created };
}

export async function updateEmailTemplateAction(templateId: string, input: EmailTemplateInput) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "emails", "edit");
  if (!permCheck.ok) return permCheck;

  const name = input.name.trim();
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!name || !subject || !body) return { ok: false as const, error: "Name, subject, and body are required." };

  const updated = await withTenant(session.tenantId!, async (tx) => {
    const existing = await tx.emailTemplate.findFirst({ where: { id: templateId, tenantId: session.tenantId! } });
    if (!existing) return null;
    return tx.emailTemplate.update({ where: { id: templateId }, data: { name, subject, body } });
  });

  if (!updated) return { ok: false as const, error: "Template not found." };

  revalidatePath("/agency/emails");
  return { ok: true as const, template: updated };
}

export async function deleteEmailTemplateAction(templateId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "emails", "delete");
  if (!permCheck.ok) return permCheck;

  const deleted = await withTenant(session.tenantId!, async (tx) => {
    const existing = await tx.emailTemplate.findFirst({ where: { id: templateId, tenantId: session.tenantId! } });
    if (!existing) return false;
    await tx.emailTemplate.delete({ where: { id: templateId } });
    return true;
  });

  if (!deleted) return { ok: false as const, error: "Template not found." };

  revalidatePath("/agency/emails");
  return { ok: true as const };
}
