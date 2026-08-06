"use server";

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";

/**
 * Starts an impersonation session: creates an ImpersonationSession record
 * and a corresponding AuditLog entry. In a real deployment the acting admin
 * would come from the authenticated session; for this seeded demo we use
 * the platform Owner as the actor.
 */
export async function startImpersonationAction(tenantId: string, reason?: string) {
  const admin = await db.user.findFirst({ where: { scope: "PLATFORM" }, orderBy: { createdAt: "asc" } });
  if (!admin) return { ok: false as const };

  const session = await db.impersonationSession.create({
    data: {
      adminId: admin.id,
      tenantId,
      reason: reason ?? "Support-assisted troubleshooting",
    },
  });

  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: "impersonation.started",
      resource: "tenant",
      tenantId,
      device: "Desktop",
      browser: "Admin Console",
      newValue: JSON.stringify({ impersonationSessionId: session.id }),
    },
  });

  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/audit-logs");

  return { ok: true as const, sessionId: session.id };
}

export async function endImpersonationAction(sessionId: string, tenantId: string) {
  await db.impersonationSession.update({
    where: { id: sessionId },
    data: { endedAt: new Date() },
  });

  const admin = await db.user.findFirst({ where: { scope: "PLATFORM" }, orderBy: { createdAt: "asc" } });

  await db.auditLog.create({
    data: {
      actorId: admin?.id,
      action: "impersonation.ended",
      resource: "tenant",
      tenantId,
      device: "Desktop",
      browser: "Admin Console",
    },
  });

  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/audit-logs");

  return { ok: true as const };
}
