"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { getSectionsForProduct } from "@/lib/sections";

/**
 * Toggles a single per-client section on/off. Upserts on (key, scope,
 * scopeId) rather than requiring an existing FeatureFlag row by id, since
 * a tenant with zero rows is the common case (see src/lib/agency/sections.ts
 * default-on resolution) -- the first toggle for a tenant creates the row.
 */
export async function setTenantSectionEnabledAction(tenantId: string, productSlug: string, sectionKey: string, enabled: boolean) {
  const admin = await getSession();
  if (!admin) return { ok: false as const, error: "Not authenticated." };
  guard(admin.role?.name ?? "", "feature-flags", "edit");

  const section = getSectionsForProduct(productSlug).find((s) => s.key === sectionKey);
  if (!section) return { ok: false as const, error: "Unknown section." };
  if (section.core) return { ok: false as const, error: "This section can't be turned off." };

  const existing = await db.featureFlag.findUnique({
    where: { key_scope_scopeId: { key: sectionKey, scope: "TENANT", scopeId: tenantId } },
  });

  await db.featureFlag.upsert({
    where: { key_scope_scopeId: { key: sectionKey, scope: "TENANT", scopeId: tenantId } },
    update: { enabled },
    create: {
      key: sectionKey,
      name: section.label,
      scope: "TENANT",
      scopeId: tenantId,
      enabled,
    },
  });

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: enabled ? "feature_flag.enabled" : "feature_flag.disabled",
      resource: "feature-flags",
      tenantId,
      oldValue: JSON.stringify({ enabled: existing?.enabled ?? true }),
      newValue: JSON.stringify({ enabled, key: sectionKey }),
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/agency");

  return { ok: true as const };
}

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
