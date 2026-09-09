"use server";

import { withPlatformAccess } from "@/lib/db";
import { getSession, setImpersonationCookie, clearImpersonationCookie } from "@/lib/auth";
import { guard } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { PRODUCT_DASHBOARD_PATH } from "@/lib/sections";

/**
 * Starts an impersonation session: creates an ImpersonationSession record,
 * an AuditLog entry, AND (as of 2026-09-09) the signed impersonation
 * cookie that actually makes getTenantSession() resolve as this tenant --
 * before this, the DB row and cookie existed but nothing ever read them
 * back, so "Login as" visibly did nothing (the banner was pure client
 * React state, see src/lib/store/impersonation.tsx's prior version). See
 * getTenantSession()'s own docstring in auth.ts for the full mechanism.
 */
export async function startImpersonationAction(tenantId: string, reason?: string) {
  const admin = await getSession();
  if (!admin) return { ok: false as const, error: "Not authenticated." };
  guard(admin.role?.name ?? "", "tenants", "edit");

  let result: { session: { id: string }; dashboardPath: string };
  try {
    result = await withPlatformAccess(async (tx) => {
      // Fail before creating the session/cookie if this tenant can't
      // actually be impersonated -- getTenantSession() would reject it
      // anyway (no owner, owner not ACTIVE), so checking here gives the
      // admin a real error message instead of a silent no-op the next
      // time any tenant page loads.
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        include: { owner: true, product: true },
      });
      if (!tenant?.owner) throw new Error("This tenant has no owner account to impersonate.");
      if (tenant.owner.status !== "ACTIVE") throw new Error("This tenant's owner account is not active.");

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
      return { session, dashboardPath: PRODUCT_DASHBOARD_PATH[tenant.product.slug] ?? "/agency" };
    });
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : "Couldn't start impersonation." };
  }

  await setImpersonationCookie({ adminId: admin.id, tenantId, impersonationSessionId: result.session.id });

  revalidatePath("/", "layout");

  return { ok: true as const, sessionId: result.session.id, dashboardPath: result.dashboardPath };
}

/**
 * Ends an impersonation session: marks the ImpersonationSession row ended,
 * clears the cookie so getTenantSession() immediately stops resolving as
 * the tenant, and logs it. Requires a real admin session -- previously
 * this only ran the permission check `if (admin)`, meaning an
 * unauthenticated caller skipped the check entirely and could still end
 * (and audit-log against) any session by id.
 */
export async function endImpersonationAction(sessionId: string, tenantId: string) {
  const admin = await getSession();
  if (!admin) return { ok: false as const };
  guard(admin.role?.name ?? "", "tenants", "edit");

  await withPlatformAccess(async (tx) => {
    await tx.impersonationSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId: admin.id,
        action: "impersonation.ended",
        resource: "tenant",
        tenantId,
        device: "Desktop",
        browser: "Admin Console",
      },
    });
  });

  await clearImpersonationCookie();

  revalidatePath("/", "layout");

  return { ok: true as const };
}
