"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { logError } from "@/lib/error-log";

export interface PlanInput {
  name: string;
  slug: string;
  maxUsers: number;
  storageLimitMb: number;
  aiCredits: number;
  monthlyPrice: number; // cents
  yearlyPrice: number; // cents
  features: string[];
  isActive: boolean;
}

function validatePlanInput(input: PlanInput): string | null {
  if (!input.name.trim()) return "Plan name is required.";
  if (!input.slug.trim() || !/^[a-z0-9-]+$/.test(input.slug)) {
    return "Slug must be lowercase letters, numbers, and hyphens only.";
  }
  if (input.maxUsers < 1) return "Max users must be at least 1.";
  if (input.storageLimitMb < 0) return "Storage limit can't be negative.";
  if (input.aiCredits < 0) return "AI credits can't be negative.";
  if (input.monthlyPrice < 0 || input.yearlyPrice < 0) return "Prices can't be negative.";
  return null;
}

export async function createPlanAction(input: PlanInput) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "billing", "edit");

  const validationError = validatePlanInput(input);
  if (validationError) return { ok: false as const, error: validationError };

  const existing = await db.plan.findUnique({ where: { slug: input.slug } });
  if (existing) return { ok: false as const, error: "A plan with this slug already exists." };

  try {
    const plan = await db.plan.create({
      data: {
        name: input.name.trim(),
        slug: input.slug.trim(),
        maxUsers: input.maxUsers,
        storageLimitMb: input.storageLimitMb,
        aiCredits: input.aiCredits,
        monthlyPrice: input.monthlyPrice,
        yearlyPrice: input.yearlyPrice,
        features: JSON.stringify(input.features.filter((f) => f.trim())),
        isActive: input.isActive,
      },
    });

    await db.auditLog.create({
      data: {
        actorId: session.id,
        action: "plan.created",
        resource: "plan",
        newValue: JSON.stringify(input),
        device: "Desktop",
        browser: "Admin Console",
      },
    });

    revalidatePath("/admin/subscriptions");
    return { ok: true as const, planId: plan.id };
  } catch (err) {
    await logError({ source: "plans.create", error: err, context: { input } });
    return { ok: false as const, error: "Failed to create plan. Please try again." };
  }
}

export async function updatePlanAction(planId: string, input: PlanInput) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "billing", "edit");

  const validationError = validatePlanInput(input);
  if (validationError) return { ok: false as const, error: validationError };

  const existingPlan = await db.plan.findUnique({ where: { id: planId } });
  if (!existingPlan) return { ok: false as const, error: "Plan not found." };

  // Slug uniqueness check excludes this plan's own current row -- editing a
  // plan without changing its slug must not trip over itself.
  const slugConflict = await db.plan.findFirst({ where: { slug: input.slug, id: { not: planId } } });
  if (slugConflict) return { ok: false as const, error: "A plan with this slug already exists." };

  try {
    await db.plan.update({
      where: { id: planId },
      data: {
        name: input.name.trim(),
        slug: input.slug.trim(),
        maxUsers: input.maxUsers,
        storageLimitMb: input.storageLimitMb,
        aiCredits: input.aiCredits,
        monthlyPrice: input.monthlyPrice,
        yearlyPrice: input.yearlyPrice,
        features: JSON.stringify(input.features.filter((f) => f.trim())),
        isActive: input.isActive,
      },
    });

    await db.auditLog.create({
      data: {
        actorId: session.id,
        action: "plan.updated",
        resource: "plan",
        oldValue: JSON.stringify({
          name: existingPlan.name,
          slug: existingPlan.slug,
          monthlyPrice: existingPlan.monthlyPrice,
          yearlyPrice: existingPlan.yearlyPrice,
        }),
        newValue: JSON.stringify(input),
        device: "Desktop",
        browser: "Admin Console",
      },
    });

    revalidatePath("/admin/subscriptions");
    return { ok: true as const };
  } catch (err) {
    await logError({ source: "plans.update", error: err, context: { planId, input } });
    return { ok: false as const, error: "Failed to update plan. Please try again." };
  }
}
