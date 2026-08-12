import { db } from "@/lib/db";

export async function getTeamMembers(tenantId: string) {
  return db.user.findMany({
    where: { tenantId },
    include: { role: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getPendingInvites(tenantId: string) {
  return db.teamInvite.findMany({
    where: { tenantId, status: "PENDING" },
    include: { role: true, invitedBy: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Agency roles only (Role.name prefixed "Agency ") -- excludes platform staff roles. */
export async function getAgencyRoles() {
  return db.role.findMany({
    where: { name: { startsWith: "Agency " } },
    orderBy: { name: "asc" },
  });
}
