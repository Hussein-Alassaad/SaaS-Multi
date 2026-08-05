import { db } from "@/lib/db";

export async function getUsersList() {
  const users = await db.user.findMany({
    include: { role: true, tenant: true },
    orderBy: { createdAt: "desc" },
  });
  return users;
}
