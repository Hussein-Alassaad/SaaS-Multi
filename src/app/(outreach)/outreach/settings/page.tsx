import { getTenantSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { safeJsonParse } from "@/lib/utils";
import { SettingsClient } from "./SettingsClient";

export default async function OutreachSettingsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const settings = await db.outreachSettings.findUniqueOrThrow({ where: { tenantId } });

  const initial = {
    targetNiche: settings.targetNiche,
    targetIndustry: settings.targetIndustry,
    targetLocation: settings.targetLocation,
    targetBusinessType: settings.targetBusinessType,
    targetCompanySizeMin: settings.targetCompanySizeMin,
    targetCompanySizeMax: settings.targetCompanySizeMax,
    targetNeeds: safeJsonParse<string[]>(settings.targetNeeds, []),
    outreachLanguages: safeJsonParse<string[]>(settings.outreachLanguages, ["English"]),
    messageStyle: settings.messageStyle,
    styleDurationDays: settings.styleDurationDays,
    defaultRecontactGapDays: settings.defaultRecontactGapDays,
    maxContactsPerLead: settings.maxContactsPerLead,
    approvalRequired: settings.approvalRequired,
    approvalReminderHours: settings.approvalReminderHours,
    whatsappRecipient1: settings.whatsappRecipient1,
    whatsappRecipient2: settings.whatsappRecipient2,
  };

  return <SettingsClient initial={initial} />;
}
