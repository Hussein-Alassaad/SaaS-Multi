"use server";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

export async function markErrorLogResolvedAction(id: string, resolved: boolean) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "monitoring", "edit");

  await db.errorLog.update({ where: { id }, data: { resolved } });
  revalidatePath("/admin/error-logs");
  return { ok: true as const };
}
