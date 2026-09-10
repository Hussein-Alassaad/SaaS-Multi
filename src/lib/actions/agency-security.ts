"use server";

import { db, withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { listApiKeysAction } from "@/lib/actions/marketing-api-keys";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// Sessions -- UserSession has no tenantId column (it's shared with the
// platform-wide Admin Security page, see src/lib/actions/security.ts) and is
// therefore NOT covered by RLS, so this filters through the `user` relation
// on the plain `db` client. That relation filter is the only tenant boundary
// here -- keep it on every query in this section.
// ---------------------------------------------------------------------------

export async function listTenantSessionsAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "security", "view");
  if (!permCheck.ok) return permCheck;

  const sessions = await db.userSession.findMany({
    where: { revokedAt: null, user: { tenantId: session.tenantId! } },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { lastActiveAt: "desc" },
    take: 100,
  });

  return {
    ok: true as const,
    sessions: sessions.map((s) => ({
      id: s.id,
      userName: s.user.name,
      userEmail: s.user.email,
      device: s.device ?? "Unknown device",
      ip: s.ip ?? "Unknown",
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

export async function revokeTenantSessionAction(sessionId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "security", "edit");
  if (!permCheck.ok) return permCheck;

  const target = await db.userSession.findFirst({
    where: { id: sessionId, user: { tenantId: session.tenantId! } },
  });
  if (!target) return { ok: false as const, error: "Session not found." };

  await db.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });

  revalidatePath("/agency/security");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// API keys -- reuses the Marketing API keys action directly rather than
// duplicating it (same data, same page section).
// ---------------------------------------------------------------------------

export async function getTenantApiKeysAction() {
  return listApiKeysAction();
}

// ---------------------------------------------------------------------------
// IP allowlist -- enforced (fail-open when empty) in loginAnyAction, see
// src/lib/actions/auth.ts.
// ---------------------------------------------------------------------------

const CIDR_PATTERN = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

export async function getTenantIpAllowlistAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "security", "view");
  if (!permCheck.ok) return permCheck;

  const entries = await withTenant(session.tenantId!, (tx) =>
    tx.tenantIpAllowlistEntry.findMany({ where: { tenantId: session.tenantId! }, orderBy: { createdAt: "asc" } })
  );

  return { ok: true as const, entries: entries.map((e) => ({ id: e.id, cidr: e.cidr, label: e.label })) };
}

export async function addTenantIpAllowlistEntryAction(cidr: string, label?: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "security", "edit");
  if (!permCheck.ok) return permCheck;

  const trimmed = cidr.trim();
  if (!CIDR_PATTERN.test(trimmed)) {
    return { ok: false as const, error: "Enter a valid IP address or CIDR range, e.g. 203.0.113.0/24." };
  }

  const existing = await withTenant(session.tenantId!, (tx) =>
    tx.tenantIpAllowlistEntry.findFirst({ where: { tenantId: session.tenantId!, cidr: trimmed } })
  );
  if (existing) return { ok: false as const, error: "This entry already exists." };

  await withTenant(session.tenantId!, (tx) =>
    tx.tenantIpAllowlistEntry.create({
      data: { tenantId: session.tenantId!, cidr: trimmed, label: label?.trim() || null, createdById: session.id },
    })
  );

  revalidatePath("/agency/security");
  return { ok: true as const };
}

export async function removeTenantIpAllowlistEntryAction(entryId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "security", "edit");
  if (!permCheck.ok) return permCheck;

  const deleted = await withTenant(session.tenantId!, async (tx) => {
    const entry = await tx.tenantIpAllowlistEntry.findFirst({ where: { id: entryId, tenantId: session.tenantId! } });
    if (!entry) return false;
    await tx.tenantIpAllowlistEntry.delete({ where: { id: entryId } });
    return true;
  });

  if (!deleted) return { ok: false as const, error: "Entry not found." };

  revalidatePath("/agency/security");
  return { ok: true as const };
}
