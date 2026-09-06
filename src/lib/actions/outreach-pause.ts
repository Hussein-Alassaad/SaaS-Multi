"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { revalidatePath } from "next/cache";

/**
 * Whole-tenant, self-service "pause my outreach" switch (2026-09-06) --
 * e.g. a client stopping everything for a couple of days. Deliberately a
 * separate concept from OutreachAccount.status ("active"/"paused"), which
 * is per-account and reserved for account-health issues under core rule R9
 * (redistribution/resuming is always a human/Admin call, never automatic).
 * This flag is fully reversible and entirely the tenant's own decision --
 * no Admin permission needed, same "settings"-resource guard the rest of
 * the tenant's own Outreach Settings page already uses.
 *
 * Checked by every Python cycle (discovery/analysis/message-generation/
 * sending/reply-send) as an early per-tenant skip -- see
 * scheduler.py's repo.get_outreach_settings()/is_tenant_paused() call
 * sites -- so pausing never touches or overwrites any individual
 * account's own status/login state.
 */
export async function getOutreachPauseStateAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "settings", "view");
  if (!permCheck.ok) return permCheck;

  const settings = await withTenant(session.tenantId!, (tx) =>
    tx.outreachSettings.findUnique({
      where: { tenantId: session.tenantId! },
      select: { paused: true, pausedAt: true },
    })
  );

  return {
    ok: true as const,
    paused: settings?.paused ?? false,
    pausedAt: settings?.pausedAt?.toISOString() ?? null,
  };
}

export async function setOutreachPauseStateAction(paused: boolean) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "settings", "edit");
  if (!permCheck.ok) return permCheck;

  await withTenant(session.tenantId!, (tx) =>
    tx.outreachSettings.update({
      where: { tenantId: session.tenantId! },
      data: { paused, pausedAt: paused ? new Date() : null },
    })
  );

  revalidatePath("/outreach");
  revalidatePath("/outreach/settings");
  return { ok: true as const };
}
