import { db } from "@/lib/db";
import { AGENCY_PERMISSION_MATRIX, agencyRoleDbName, type AgencyRole } from "@/lib/agency-permissions";
import { SYSTEM_ROLES, PERMISSION_MATRIX, type SystemRole } from "@/lib/permissions";

/**
 * Minimal fixtures for signup/payment-review tests — deliberately not a
 * full copy of prisma/seed.ts, just what each test file's scenarios need:
 * one Product, one active Plan, the agency Owner role, and (for
 * payment-review tests) a Finance platform role.
 */
export async function seedMinimalFixtures() {
  const product = await db.product.create({
    data: { slug: "marketing", name: "Marketing Platform", status: "ACTIVE" },
  });

  const plan = await db.plan.create({
    data: {
      name: "Basic",
      slug: "basic",
      maxUsers: 5,
      storageLimitMb: 2048,
      aiCredits: 500,
      monthlyPrice: 2900,
      yearlyPrice: 29000,
    },
  });

  for (const name of Object.keys(AGENCY_PERMISSION_MATRIX) as AgencyRole[]) {
    const resourceMap = AGENCY_PERMISSION_MATRIX[name];
    const perms = Object.entries(resourceMap).flatMap(([resource, actions]) =>
      (actions ?? []).map((action) => ({ resource, action }))
    );
    await db.role.create({
      data: { name: agencyRoleDbName(name), isSystem: true, permissions: { create: perms } },
    });
  }

  for (const name of SYSTEM_ROLES as unknown as SystemRole[]) {
    const resourceMap = PERMISSION_MATRIX[name];
    const perms = Object.entries(resourceMap).flatMap(([resource, actions]) =>
      (actions ?? []).map((action) => ({ resource, action }))
    );
    await db.role.create({
      data: { name, isSystem: true, permissions: { create: perms } },
    });
  }

  return { product, plan };
}

/**
 * A tenant plus one ACTIVE Agency Owner user, for tests of tenant-scoped
 * Marketing actions (settings/files/api-keys/etc.) that call getTenantSession()
 * -- callers mock getTenantSession() to resolve to the returned `owner` row.
 */
export async function createTenantWithOwner(opts: { productId: string; subdomain: string; email?: string }) {
  const tenant = await db.tenant.create({
    data: { productId: opts.productId, companyName: "Acme Agency", subdomain: opts.subdomain, status: "ACTIVE" },
  });
  const ownerRole = await db.role.findUnique({ where: { name: agencyRoleDbName("Owner") } });
  const owner = await db.user.create({
    data: {
      email: opts.email ?? `owner-${opts.subdomain}@acme.example.com`,
      name: "Jane Owner",
      scope: "TENANT",
      status: "ACTIVE",
      tenantId: tenant.id,
      roleId: ownerRole!.id,
    },
    include: { role: true },
  });
  return { tenant, owner };
}

/** Deletes all rows created by tests, in FK-safe order. Call in afterEach. */
export async function resetDb() {
  await db.auditLog.deleteMany();
  await db.payment.deleteMany();
  await db.subscription.deleteMany();
  await db.teamInvite.deleteMany();
  await db.companySettings.deleteMany();
  await db.smtpConfig.deleteMany();
  await db.localizationSettings.deleteMany();
  await db.marketingFile.deleteMany();
  await db.tenantApiKey.deleteMany();
  await db.emailTemplate.deleteMany();
  await db.scheduledReport.deleteMany();
  await db.tenantIpAllowlistEntry.deleteMany();
  await db.user.deleteMany();
  await db.tenant.deleteMany();
  await db.plan.deleteMany();
  await db.product.deleteMany();
  await db.permission.deleteMany();
  await db.role.deleteMany();
}
