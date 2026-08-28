"use server";

import { withPlatformAccess } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

/**
 * Starts an impersonation session: creates an ImpersonationSession record
 * and a corresponding AuditLog entry. The acting admin is the currently
 * authenticated platform user.
 */
export async function startImpersonationAction(tenantId: string, reason?: string) {
  const admin = await getSession();
  if (!admin) return { ok: false as const };
  guard(admin.role?.name ?? "", "tenants", "edit");

  const session = await withPlatformAccess(async (tx) => {
    const session = await tx.impersonationSession.create({
      data: {
        adminId: admin.id,
        tenantId,
        reason: reason ?? "Support-assisted troubleshooting",
      },
    });

    await tx.auditLog.create({
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
    return session;
  });

  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/audit-logs");

  return { ok: true as const, sessionId: session.id };
}

export async function endImpersonationAction(sessionId: string, tenantId: string) {
  const admin = await getSession();
  if (admin) guard(admin.role?.name ?? "", "tenants", "edit");

  await withPlatformAccess(async (tx) => {
    await tx.impersonationSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId: admin?.id,
        action: "impersonation.ended",
        resource: "tenant",
        tenantId,
        device: "Desktop",
        browser: "Admin Console",
      },
    });
  });

  revalidatePath("/admin/tenants");
  revalidatePath(`/admin/tenants/${tenantId}`);
  revalidatePath("/admin/audit-logs");

  return { ok: true as const };
}
