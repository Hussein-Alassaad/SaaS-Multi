/**
 * One-time reset: deletes every seeded/demo row and leaves exactly one real
 * Platform Owner account behind, so the app is a genuinely empty system
 * ready for real signups instead of full of prisma/seed.ts's fake tenants/
 * leads/conversations. Distinct from `npm run db:seed`, which recreates all
 * the demo data -- this script is the opposite operation, run manually,
 * never as part of a normal setup/deploy flow.
 *
 * Product rows (Marketing/Gym/Outreach) are deliberately NOT wiped and
 * NOT recreated from scratch here -- they're structural platform config
 * (which products exist at all), not demo data, and the public /signup
 * flow (src/lib/actions/signup.ts) looks one up by slug on every signup.
 * Wiping them would break signup until manually restored.
 *
 * Usage: npx tsx scripts/wipe-to-empty.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PERMISSION_MATRIX } from "../src/lib/permissions";
import { AGENCY_PERMISSION_MATRIX, agencyRoleDbName, type AgencyRole } from "../src/lib/agency-permissions";
import { OUTREACH_PERMISSION_MATRIX, outreachRoleDbName, type OutreachRole } from "../src/lib/outreach-permissions";

const db = new PrismaClient();

const ADMIN_EMAIL = "admin@nexaris.app";
const ADMIN_PASSWORD = "ov6TMPluU4Q6tN";
const ADMIN_NAME = "Admin";

async function main() {
  console.log("Wiping all seeded/demo data...");

  // Outreach tables (postdate prisma/seed.ts's delete list, not covered there)
  await db.outreachReply.deleteMany();
  await db.outreachRun.deleteMany();
  await db.outreachNotificationLog.deleteMany();
  await db.outreachClientHistory.deleteMany();
  await db.outreachFollowUp.deleteMany();
  await db.outreachPipelineHistory.deleteMany();
  await db.outreachMessage.deleteMany();
  await db.outreachLead.deleteMany();
  await db.outreachSettings.deleteMany();
  await db.outreachAccount.deleteMany();

  await db.errorLog.deleteMany();

  // Marketing / Agency OS + shared platform tables, same order as prisma/seed.ts
  await db.meetingRequest.deleteMany();
  await db.meetingSlot.deleteMany();
  await db.message.deleteMany();
  await db.conversation.deleteMany();
  await db.channel.deleteMany();
  await db.nexarisClient.deleteMany();
  await db.knowledgeEntry.deleteMany();
  await db.tenantFeatureRequest.deleteMany();
  await db.aiSettings.deleteMany();
  await db.teamInvite.deleteMany();
  await db.impersonationSession.deleteMany();
  await db.auditLog.deleteMany();
  await db.aiUsageLog.deleteMany();
  await db.aiBudget.deleteMany();
  await db.supportTicket.deleteMany();
  await db.refund.deleteMany();
  await db.payment.deleteMany();
  await db.invoice.deleteMany();
  await db.subscription.deleteMany();
  await db.featureFlag.deleteMany();
  await db.notification.deleteMany();
  await db.user.deleteMany();
  await db.tenant.deleteMany();
  await db.plan.deleteMany();
  await db.permission.deleteMany();
  await db.role.deleteMany();
  // Product rows intentionally NOT deleted -- see file header comment.

  console.log("Wiped (Products kept). Creating the one real Platform Owner role + account...");

  // Same generation pattern as seed.ts: Permission rows derived directly
  // from PERMISSION_MATRIX (src/lib/permissions.ts) so what's enforced in
  // code and what's shown on the Roles page never drift apart.
  const ownerPerms: { resource: string; action: string }[] = [];
  for (const [resource, actions] of Object.entries(PERMISSION_MATRIX.Owner)) {
    for (const action of actions ?? []) {
      ownerPerms.push({ resource, action });
    }
  }

  const ownerRole = await db.role.create({
    data: {
      name: "Owner",
      description: "Owner — internal platform role",
      isSystem: true,
      permissions: { create: ownerPerms },
    },
  });

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await db.user.create({
    data: {
      email: ADMIN_EMAIL,
      name: ADMIN_NAME,
      scope: "PLATFORM",
      status: "ACTIVE",
      roleId: ownerRole.id,
      passwordHash,
    },
  });

  // Tenant-facing role sets (Agency OS's 6 roles, Outreach's 3 roles) --
  // not demo data, structural like Products: real tenant creation (admin's
  // "New Tenant" button, team invites) assigns a roleId and fails without
  // these existing. Without this step here, a wipe silently breaks tenant
  // creation until scripts/seed-tenant-roles.ts is run separately.
  console.log("Creating tenant-facing role sets (Agency OS, Outreach)...");

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
    await db.role.create({
      data: {
        name: agencyRoleDbName(name),
        description: `${name} — Agency OS tenant role`,
        isSystem: true,
        permissions: { create: perms },
      },
    });
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
    await db.role.create({
      data: {
        name: outreachRoleDbName(name),
        description: `${name} — Outreach tenant role`,
        isSystem: true,
        permissions: { create: perms },
      },
    });
  }

  console.log("Done. The system is empty except for one real login:");
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log("No products, tenants, plans, or demo data remain.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
