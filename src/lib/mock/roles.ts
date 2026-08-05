import { db } from "@/lib/db";

export async function getRolesWithPermissions() {
  const roles = await db.role.findMany({
    include: { permissions: true, users: true },
    orderBy: { name: "asc" },
  });
  return roles;
}
