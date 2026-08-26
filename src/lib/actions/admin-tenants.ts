"use server";

import { db } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { agencyRoleDbName } from "@/lib/agency-permissions";
import { outreachRoleDbName } from "@/lib/outreach-permissions";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const createTenantSchema = z.object({
  productSlug: z.enum(["marketing", "outreach"]),
  companyName: z.string().min(1, "Company name is required").max(120),
  subdomain: z
    .string()
    .min(2, "Workspace URL must be at least 2 characters")
    .max(63)
    .regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and hyphens only"),
  ownerName: z.string().min(1, "Owner name is required").max(120),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/**
 * Admin-created tenant: lands ACTIVE immediately, no plan/payment step --
 * unlike the public /signup flow (Marketing only, lands in TRIAL, needs a
 * Plan selected). This is the only onboarding path Outreach has at all
 * (no public signup exists for it -- Outreach clients are hand-onboarded
 * by the platform team, not self-serve).
 */
export async function createTenantAction(input: CreateTenantInput) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "tenants", "create");

  const parsed = createTenantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const data = parsed.data;

  const product = await db.product.findUnique({ where: { slug: data.productSlug } });
  if (!product) return { ok: false as const, error: "That product doesn't exist." };

  const ownerRoleName = data.productSlug === "marketing" ? agencyRoleDbName("Owner") : outreachRoleDbName("Owner");
  const ownerRole = await db.role.findUnique({ where: { name: ownerRoleName } });
  if (!ownerRole) return { ok: false as const, error: "Owner role is not configured for this product." };

  const [existingSubdomain, existingEmail] = await Promise.all([
    db.tenant.findUnique({ where: { subdomain: data.subdomain } }),
    db.user.findUnique({ where: { email: data.email } }),
  ]);
  if (existingSubdomain) return { ok: false as const, error: "That workspace URL is already taken." };
  if (existingEmail) return { ok: false as const, error: "An account with that email already exists." };

  const passwordHash = await hashPassword(data.password);

  const tenant = await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        productId: product.id,
        companyName: data.companyName,
        subdomain: data.subdomain,
        status: "ACTIVE",
      },
    });

    const owner = await tx.user.create({
      data: {
        email: data.email,
        name: data.ownerName,
        scope: "TENANT",
        status: "ACTIVE",
        roleId: ownerRole.id,
        tenantId: tenant.id,
        passwordHash,
      },
    });

    await tx.tenant.update({ where: { id: tenant.id }, data: { ownerId: owner.id } });

    if (data.productSlug === "outreach") {
      await tx.outreachSettings.create({ data: { tenantId: tenant.id } });
    }

    await tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "tenant.created_by_admin",
        resource: "tenant",
        tenantId: tenant.id,
        newValue: JSON.stringify({ companyName: data.companyName, productSlug: data.productSlug }),
        device: "Desktop",
        browser: "Admin",
      },
    });

    return tenant;
  });

  revalidatePath("/admin/tenants");
  return { ok: true as const, tenantId: tenant.id };
}

function generatePassword(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/**
 * Generates a brand new password for a tenant's owner and returns it
 * once, in plaintext, to the admin who requested it -- the only way to
 * hand a client working credentials after the fact, since passwords are
 * hashed one-way and never stored/shown anywhere after creation (including
 * right after createTenantAction() -- if the admin didn't copy it down at
 * that moment, this is the only way back in).
 */
export async function resetTenantOwnerPasswordAction(tenantId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "tenants", "edit");

  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, include: { owner: true } });
  if (!tenant) return { ok: false as const, error: "Tenant not found." };
  if (!tenant.owner) return { ok: false as const, error: "This tenant has no owner account set." };

  const newPassword = generatePassword();
  const passwordHash = await hashPassword(newPassword);

  await db.$transaction([
    db.user.update({ where: { id: tenant.owner.id }, data: { passwordHash } }),
    db.auditLog.create({
      data: {
        actorId: session.id,
        action: "tenant.owner_password_reset",
        resource: "tenant",
        tenantId: tenant.id,
        device: "Desktop",
        browser: "Admin",
      },
    }),
  ]);

  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true as const, email: tenant.owner.email, password: newPassword };
}

/**
 * "Remove a tenant" -- deliberately a deactivation (status -> CHURNED), not
 * a hard delete. This is real client data (leads, messages, payment
 * history) that stays fully intact and reversible via reactivateTenantAction
 * below; a permanent wipe is a much higher-risk, separate action this admin
 * dashboard does not currently expose at all. Also revokes every one of the
 * tenant's users' active sessions (same mechanism src/lib/actions/security.ts's
 * revokeSessionAction uses) so a deactivated tenant's team is force-logged-out
 * immediately, not just blocked from a future login attempt.
 */
export async function deactivateTenantAction(tenantId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "tenants", "delete");

  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
  if (!tenant) return { ok: false as const, error: "Tenant not found." };
  if (tenant.status === "CHURNED") return { ok: false as const, error: "This tenant is already deactivated." };

  await db.$transaction([
    db.tenant.update({ where: { id: tenantId }, data: { status: "CHURNED" } }),
    db.userSession.updateMany({
      where: { user: { tenantId }, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    db.auditLog.create({
      data: {
        actorId: session.id,
        action: "tenant.deactivated",
        resource: "tenant",
        tenantId,
        oldValue: JSON.stringify({ status: tenant.status }),
        newValue: JSON.stringify({ status: "CHURNED" }),
        device: "Desktop",
        browser: "Admin",
      },
    }),
  ]);

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/tenants");
  return { ok: true as const };
}

/** Reverses deactivateTenantAction -- status back to ACTIVE. Sessions stay
 * revoked (the team must log back in fresh, not get silently restored). */
export async function reactivateTenantAction(tenantId: string) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "tenants", "delete");

  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } });
  if (!tenant) return { ok: false as const, error: "Tenant not found." };
  if (tenant.status !== "CHURNED") return { ok: false as const, error: "This tenant is not deactivated." };

  await db.$transaction([
    db.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } }),
    db.auditLog.create({
      data: {
        actorId: session.id,
        action: "tenant.reactivated",
        resource: "tenant",
        tenantId,
        oldValue: JSON.stringify({ status: "CHURNED" }),
        newValue: JSON.stringify({ status: "ACTIVE" }),
        device: "Desktop",
        browser: "Admin",
      },
    }),
  ]);

  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/tenants");
  return { ok: true as const };
}

/**
 * Sets an Outreach account's daily send/discovery caps -- deliberately
 * Admin-only (guard("tenants", "edit") checks a PLATFORM session, not
 * outreachGuardResult()'s tenant-scoped check). These 3 fields used to be
 * client-editable on Account Health; that path is now locked to read-only
 * display (see src/lib/actions/outreach-accounts.ts's saveAccountDraftAction,
 * which strips them from what a tenant session can submit) so a client
 * can no longer raise their own daily limits -- e.g. to avoid the exact
 * warm-up/pacing safety limits this project's own architecture is built
 * around (see outreach/agent/core/warmup.py). Only the field the caller
 * actually sends gets written -- an Instagram account's linkedinDailyLimit
 * is left untouched, and vice versa, matching which field the UI shows
 * for that account's platform.
 */
export async function setOutreachDailyLimitAction(
  accountId: string,
  tenantId: string,
  field: "igDailyLimit" | "linkedinDailyLimit" | "emailDailyLimit",
  value: number
) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "tenants", "edit");

  if (!Number.isFinite(value) || value < 0) {
    return { ok: false as const, error: "Enter a valid, non-negative number." };
  }

  const account = await db.outreachAccount.findFirst({ where: { id: accountId, tenantId } });
  if (!account) return { ok: false as const, error: "Account not found." };

  const oldValue = account[field];
  await db.outreachAccount.update({ where: { id: accountId }, data: { [field]: value } });

  await db.auditLog.create({
    data: {
      actorId: session.id,
      action: "outreach_account.daily_limit_changed",
      resource: "outreach_account",
      tenantId,
      oldValue: JSON.stringify({ [field]: oldValue }),
      newValue: JSON.stringify({ [field]: value }),
      device: "Desktop",
      browser: "Admin",
    },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true as const };
}
