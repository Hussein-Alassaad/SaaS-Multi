"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult, agencyRoleDbName, AGENCY_ROLES, type AgencyRole } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";

/** No email delivery is wired in -- the invite row is created as PENDING and shown in the UI, same posture as Phase 2's mock integrations. */
export async function inviteTeamMemberAction(email: string, role: AgencyRole) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "team", "create");
  if (!permCheck.ok) return permCheck;

  if (!email.trim() || !email.includes("@")) return { ok: false as const, error: "Enter a valid email." };
  if (!AGENCY_ROLES.includes(role)) return { ok: false as const, error: "Invalid role." };

  const existingUser = await db.user.findUnique({ where: { email: email.trim() } });
  if (existingUser) return { ok: false as const, error: "That email is already a member." };

  const existingInvite = await db.teamInvite.findFirst({
    where: { tenantId: session.tenantId!, email: email.trim(), status: "PENDING" },
  });
  if (existingInvite) return { ok: false as const, error: "An invite is already pending for that email." };

  const roleRow = await db.role.findUnique({ where: { name: agencyRoleDbName(role) } });
  if (!roleRow) return { ok: false as const, error: "Role not found." };

  await db.teamInvite.create({
    data: { tenantId: session.tenantId!, email: email.trim(), roleId: roleRow.id, invitedById: session.id },
  });

  await db.auditLog.create({
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

  revalidatePath("/agency/team");

  return { ok: true as const };
}

export async function revokeInviteAction(inviteId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "team", "delete");
  if (!permCheck.ok) return permCheck;

  const invite = await db.teamInvite.findFirst({ where: { id: inviteId, tenantId: session.tenantId! } });
  if (!invite) return { ok: false as const, error: "Invite not found." };

  await db.teamInvite.update({ where: { id: inviteId }, data: { status: "REVOKED" } });

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
