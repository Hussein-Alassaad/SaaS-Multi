"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";

export async function updateAiSettingsAction(input: {
  tone: string;
  primaryLanguage: string;
  allowEnglish: boolean;
  qualificationRules: string;
  approvalRequired: boolean;
  model: string;
}) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "settings", "edit");
  if (!permCheck.ok) return permCheck;

  await withTenant(session.tenantId!, (tx) =>
    tx.aiSettings.upsert({
      where: { tenantId: session.tenantId! },
      update: input,
      create: { tenantId: session.tenantId!, ...input },
    })
  );

  revalidatePath("/agency/settings");
  revalidatePath("/agency/ai-control");
  return { ok: true as const };
}
