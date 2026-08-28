"use server";

import { db, withPlatformAccess } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

export interface UpdateGlobalAiSettingsInput {
  defaultModel: string;
  dailyBudgetCents: number;
  monthlyBudgetCents: number;
  rateLimitPerMin: number;
  cachingEnabled: boolean;
}

async function getGlobalBudget() {
  return db.aiBudget.findFirst({ where: { scope: "GLOBAL" } });
}

export async function updateGlobalAiSettingsAction(input: UpdateGlobalAiSettingsInput) {
  const admin = await getSession();
  if (!admin) return { ok: false as const, error: "Not authenticated." };
  guard(admin.role?.name ?? "", "ai", "edit");

  const existing = await getGlobalBudget();
  if (!existing) return { ok: false as const, error: "No global AI budget row found." };

  await db.aiBudget.update({
    where: { id: existing.id },
    data: {
      defaultModel: input.defaultModel,
      dailyBudgetCents: input.dailyBudgetCents,
      monthlyBudgetCents: input.monthlyBudgetCents,
      rateLimitPerMin: input.rateLimitPerMin,
      cachingEnabled: input.cachingEnabled,
    },
  });

  await withPlatformAccess((tx) =>
    tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "ai.settings.updated",
        resource: "ai",
        oldValue: JSON.stringify({
          defaultModel: existing.defaultModel,
          dailyBudgetCents: existing.dailyBudgetCents,
          monthlyBudgetCents: existing.monthlyBudgetCents,
          rateLimitPerMin: existing.rateLimitPerMin,
          cachingEnabled: existing.cachingEnabled,
        }),
        newValue: JSON.stringify(input),
        device: "Desktop",
        browser: "Admin Console",
      },
    })
  );

  revalidatePath("/admin/ai");
  return { ok: true as const };
}

export async function setAiKillSwitchAction(enabled: boolean) {
  const admin = await getSession();
  if (!admin) return { ok: false as const, error: "Not authenticated." };
  guard(admin.role?.name ?? "", "ai", "manage");

  const existing = await getGlobalBudget();
  if (!existing) return { ok: false as const, error: "No global AI budget row found." };

  await db.aiBudget.update({
    where: { id: existing.id },
    data: { killSwitchEnabled: enabled },
  });

  await withPlatformAccess((tx) =>
    tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: enabled ? "ai.kill_switch.activated" : "ai.kill_switch.restored",
        resource: "ai",
        oldValue: JSON.stringify({ killSwitchEnabled: existing.killSwitchEnabled }),
        newValue: JSON.stringify({ killSwitchEnabled: enabled }),
        device: "Desktop",
        browser: "Admin Console",
      },
    })
  );

  revalidatePath("/admin/ai");
  return { ok: true as const };
}

export async function setProductAiKillSwitchAction(productId: string, enabled: boolean) {
  const admin = await getSession();
  if (!admin) return { ok: false as const, error: "Not authenticated." };
  guard(admin.role?.name ?? "", "ai", "manage");

  const existing = await db.aiBudget.findFirst({ where: { scope: "PRODUCT", scopeId: productId } });
  if (!existing) return { ok: false as const, error: "No AI budget row found for this product." };

  await db.aiBudget.update({
    where: { id: existing.id },
    data: { killSwitchEnabled: enabled },
  });

  await withPlatformAccess((tx) =>
    tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: enabled ? "ai.kill_switch.activated" : "ai.kill_switch.restored",
        resource: "ai",
        oldValue: JSON.stringify({ killSwitchEnabled: existing.killSwitchEnabled }),
        newValue: JSON.stringify({ killSwitchEnabled: enabled, productId }),
        device: "Desktop",
        browser: "Admin Console",
      },
    })
  );

  revalidatePath(`/admin/products`);
  revalidatePath(`/admin/ai`);
  return { ok: true as const };
}
