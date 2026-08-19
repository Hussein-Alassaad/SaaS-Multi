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
