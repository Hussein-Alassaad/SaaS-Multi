"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";

export async function saveOutreachSettingsAction(input: {
  businessName: string;
  businessDescription: string;
  targetNiche: string;
  targetIndustry: string;
  targetLocation: string;
  targetBusinessType: string;
  targetCompanySizeMin: number | null;
  targetCompanySizeMax: number | null;
  targetNeeds: string[];
  outreachLanguages: string[];
  messageStyle: string;
  styleDurationDays: number;
  defaultRecontactGapDays: number;
  maxContactsPerLead: number;
  approvalRequired: boolean;
  approvalReminderHours: number;
  whatsappRecipient1: string | null;
  whatsappRecipient2: string | null;
}) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "settings", "edit");
  if (!permCheck.ok) return permCheck;

  await withTenant(session.tenantId!, (tx) =>
    tx.outreachSettings.update({
      where: { tenantId: session.tenantId! },
      data: {
        businessName: input.businessName,
        businessDescription: input.businessDescription,
        targetNiche: input.targetNiche,
        targetIndustry: input.targetIndustry,
        targetLocation: input.targetLocation,
        targetBusinessType: input.targetBusinessType,
        targetCompanySizeMin: input.targetCompanySizeMin,
        targetCompanySizeMax: input.targetCompanySizeMax,
        targetNeeds: JSON.stringify(input.targetNeeds),
        outreachLanguages: JSON.stringify(input.outreachLanguages),
        messageStyle: input.messageStyle,
        styleDurationDays: input.styleDurationDays,
        defaultRecontactGapDays: input.defaultRecontactGapDays,
        maxContactsPerLead: input.maxContactsPerLead,
        approvalRequired: input.approvalRequired,
        approvalReminderHours: input.approvalReminderHours,
        whatsappRecipient1: input.whatsappRecipient1 || null,
        whatsappRecipient2: input.whatsappRecipient2 || null,
      },
    })
  );

  return { ok: true as const };
}
