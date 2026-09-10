"use server";

import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { companySettingsSchema, type CompanySettingsInput } from "@/types/marketing-settings";
import { revalidatePath } from "next/cache";

/** CompanySettings is 1:1 with Tenant; create a default row on first access so pages never see null. */
async function readCompanySettings(tx: Prisma.TransactionClient, tenantId: string) {
  const existing = await tx.companySettings.findUnique({ where: { tenantId } });
  if (existing) return existing;
  return tx.companySettings.create({ data: { tenantId } });
}

export async function getCompanySettingsAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "settings", "view");
  if (!permCheck.ok) return permCheck;

  const settings = await withTenant(session.tenantId!, (tx) => readCompanySettings(tx, session.tenantId!));
  return { ok: true as const, settings };
}

export async function updateCompanySettingsAction(input: CompanySettingsInput) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "settings", "edit");
  if (!permCheck.ok) return permCheck;

  const parsed = companySettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const data = parsed.data;

  const updated = await withTenant(session.tenantId!, async (tx) => {
    const settings = await tx.companySettings.upsert({
      where: { tenantId: session.tenantId! },
      update: data,
      create: { tenantId: session.tenantId!, ...data },
    });

    await tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "company_settings.updated",
        resource: "settings",
        tenantId: session.tenantId,
        newValue: JSON.stringify(data),
        device: "Desktop",
        browser: "Agency OS",
      },
    });

    return settings;
  });

  revalidatePath("/agency/settings");
  return { ok: true as const, settings: updated };
}
