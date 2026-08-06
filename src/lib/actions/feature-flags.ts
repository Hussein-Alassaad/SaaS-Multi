"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

export async function setFeatureFlagEnabledAction(flagId: string, enabled: boolean) {
  const admin = await getSession();
  if (!admin) return { ok: false as const, error: "Not authenticated." };
  guard(admin.role?.name ?? "", "feature-flags", "edit");

  const existing = await db.featureFlag.findUnique({ where: { id: flagId } });
  if (!existing) return { ok: false as const, error: "Flag not found." };

  await db.featureFlag.update({
    where: { id: flagId },
    data: { enabled },
  });

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: enabled ? "feature_flag.enabled" : "feature_flag.disabled",
      resource: "feature-flags",
      tenantId: existing.scope === "TENANT" ? existing.scopeId : null,
      oldValue: JSON.stringify({ enabled: existing.enabled }),
      newValue: JSON.stringify({ enabled, key: existing.key, scope: existing.scope }),
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath("/admin/feature-flags");
  revalidatePath("/admin/tenants");
  revalidatePath("/admin/products");

  return { ok: true as const };
}
