/**
 * Seeds the tenant-facing role sets (Agency OS's 6 roles, Outreach's 3
 * roles) that prisma/seed.ts normally creates -- needed for real tenants to
 * exist at all (Tenant creation, team invites, etc. all assign a roleId).
 * scripts/wipe-to-empty.ts only recreates the platform "Owner" role, not
 * these, since it was written to leave a minimal empty system; this fills
 * that gap without re-wiping anything else.
 *
 * Usage: npx tsx scripts/seed-tenant-roles.ts
 */
import { PrismaClient } from "@prisma/client";
import { AGENCY_PERMISSION_MATRIX, agencyRoleDbName, type AgencyRole } from "../src/lib/agency-permissions";
import { OUTREACH_PERMISSION_MATRIX, outreachRoleDbName, type OutreachRole } from "../src/lib/outreach-permissions";

const db = new PrismaClient();

async function main() {
  const agencyRoleDefs = Object.fromEntries(
    Object.entries(AGENCY_PERMISSION_MATRIX).map(([roleName, resourceMap]) => {
      const perms: { resource: string; action: string }[] = [];
      for (const [resource, actions] of Object.entries(resourceMap)) {
        for (const action of actions ?? []) perms.push({ resource, action });
      }
      return [roleName, perms];
    })
  ) as Record<AgencyRole, { resource: string; action: string }[]>;

  for (const [name, perms] of Object.entries(agencyRoleDefs) as [AgencyRole, { resource: string; action: string }[]][]) {
    const dbName = agencyRoleDbName(name);
    const existing = await db.role.findUnique({ where: { name: dbName } });
    if (existing) continue;
    await db.role.create({
      data: { name: dbName, description: `${name} — Agency OS tenant role`, isSystem: true, permissions: { create: perms } },
    });
    console.log(`Created role: ${dbName}`);
  }

  const outreachRoleDefs = Object.fromEntries(
    Object.entries(OUTREACH_PERMISSION_MATRIX).map(([roleName, resourceMap]) => {
      const perms: { resource: string; action: string }[] = [];
      for (const [resource, actions] of Object.entries(resourceMap)) {
        for (const action of actions ?? []) perms.push({ resource, action });
      }
      return [roleName, perms];
    })
  ) as Record<OutreachRole, { resource: string; action: string }[]>;

  for (const [name, perms] of Object.entries(outreachRoleDefs) as [OutreachRole, { resource: string; action: string }[]][]) {
    const dbName = outreachRoleDbName(name);
    const existing = await db.role.findUnique({ where: { name: dbName } });
    if (existing) continue;
    await db.role.create({
      data: { name: dbName, description: `${name} — Outreach tenant role`, isSystem: true, permissions: { create: perms } },
    });
    console.log(`Created role: ${dbName}`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
