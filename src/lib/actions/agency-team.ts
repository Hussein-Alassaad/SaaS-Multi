"use server";

import { db, withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult, agencyRoleDbName, AGENCY_ROLES, type AgencyRole } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";
import { sendEmail } from "@/lib/email";
import { teamInviteEmail } from "@/lib/email-templates";

export async function inviteTeamMemberAction(email: string, role: AgencyRole) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "team", "create");
  if (!permCheck.ok) return permCheck;

  if (!email.trim() || !email.includes("@")) return { ok: false as const, error: "Enter a valid email." };
  if (!AGENCY_ROLES.includes(role)) return { ok: false as const, error: "Invalid role." };

  const existingUser = await db.user.findUnique({ where: { email: email.trim() } });
  if (existingUser) return { ok: false as const, error: "That email is already a member." };

  const existingInvite = await withTenant(session.tenantId!, (tx) =>
    tx.teamInvite.findFirst({
      where: { tenantId: session.tenantId!, email: email.trim(), status: "PENDING" },
    })
  );
  if (existingInvite) return { ok: false as const, error: "An invite is already pending for that email." };

  const roleRow = await db.role.findUnique({ where: { name: agencyRoleDbName(role) } });
  if (!roleRow) return { ok: false as const, error: "Role not found." };

  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId! } });

  // TeamInvite and AuditLog are both RLS tables; User/Role/Tenant above are
  // not, so they stay on the plain client.
  const invite = await withTenant(session.tenantId!, async (tx) => {
    const invite = await tx.teamInvite.create({
      data: { tenantId: session.tenantId!, email: email.trim(), roleId: roleRow.id, invitedById: session.id },
    });

    await tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "team.invited",
        resource: "team",
        tenantId: session.tenantId,
        newValue: JSON.stringify({ email: email.trim(), role }),
        device: "Desktop",
        browser: "Agency OS",
      },
    });
    return invite;
  });

  // TeamInvite.id doubles as the accept-link token: cuids are already
  // unguessable, so no separate token column is needed for this flow.
  const acceptUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/accept-invite?inviteId=${invite.id}`;
  await sendEmail({
    to: email.trim(),
    ...teamInviteEmail(session.name, tenant?.companyName ?? "your team", acceptUrl),
  });

  revalidatePath("/agency/team");

  return { ok: true as const };
}

export async function revokeInviteAction(inviteId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "team", "delete");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const invite = await tx.teamInvite.findFirst({ where: { id: inviteId, tenantId: session.tenantId! } });
    if (!invite) return false;
    await tx.teamInvite.update({ where: { id: inviteId }, data: { status: "REVOKED" } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Invite not found." };

  revalidatePath("/agency/team");

  return { ok: true as const };
}

export async function updateMemberRoleAction(userId: string, role: AgencyRole) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "team", "edit");
  if (!permCheck.ok) return permCheck;

  if (!AGENCY_ROLES.includes(role)) return { ok: false as const, error: "Invalid role." };

  const member = await db.user.findFirst({ where: { id: userId, tenantId: session.tenantId! } });
  if (!member) return { ok: false as const, error: "Team member not found." };

  const roleRow = await db.role.findUnique({ where: { name: agencyRoleDbName(role) } });
  if (!roleRow) return { ok: false as const, error: "Role not found." };

  await db.user.update({ where: { id: userId }, data: { roleId: roleRow.id } });

  revalidatePath("/agency/team");

  return { ok: true as const };
}

export async function removeMemberAction(userId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "team", "delete");
  if (!permCheck.ok) return permCheck;

  if (userId === session.id) return { ok: false as const, error: "You cannot remove yourself." };

  const member = await db.user.findFirst({ where: { id: userId, tenantId: session.tenantId! } });
  if (!member) return { ok: false as const, error: "Team member not found." };

  await db.user.update({ where: { id: userId }, data: { status: "DISABLED" } });

  revalidatePath("/agency/team");

  return { ok: true as const };
}
