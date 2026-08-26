"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { safeJsonParse } from "@/lib/utils";

/**
 * ErrorLog is shared across the whole app (src/lib/error-log.ts's logError())
 * -- Outreach doesn't get its own table. Outreach errors are tenant-scoped
 * rows whose `source` starts with "outreach." (e.g. "outreach.discovery",
 * "outreach.ses.send"); stage/channel/leadId/accountId, which the original
 * single-tenant app stored as real columns, live in the JSON `context` blob
 * here instead (already how logError() stores extra detail).
 */
export async function getOutreachErrorsAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "errors", "view");
  if (!permCheck.ok) return permCheck;

  const rows = await db.errorLog.findMany({
    where: { tenantId: session.tenantId!, source: { startsWith: "outreach." } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const leadIds = new Set<string>();
  const accountIds = new Set<string>();
  const parsedContexts = rows.map((r) => {
    const ctx = safeJsonParse<Record<string, unknown>>(r.context, {});
    if (typeof ctx.leadId === "string") leadIds.add(ctx.leadId);
    if (typeof ctx.accountId === "string") accountIds.add(ctx.accountId);
    return ctx;
  });

  const [leads, accounts] = await Promise.all([
    leadIds.size
      ? db.outreachLead.findMany({
          where: { id: { in: [...leadIds] }, tenantId: session.tenantId! },
          select: { id: true, businessName: true },
        })
      : Promise.resolve([]),
    accountIds.size
      ? db.outreachAccount.findMany({
          where: { id: { in: [...accountIds] }, tenantId: session.tenantId! },
          select: { id: true, label: true },
        })
      : Promise.resolve([]),
  ]);
  const leadNames = Object.fromEntries(leads.map((l) => [l.id, l.businessName]));
  const accountLabels = Object.fromEntries(accounts.map((a) => [a.id, a.label]));

  return {
    ok: true as const,
    errors: rows.map((r, i) => {
      const ctx = parsedContexts[i];
      const stage = typeof ctx.stage === "string" ? ctx.stage : r.source.replace(/^outreach\./, "");
      const channel = typeof ctx.channel === "string" ? ctx.channel : null;
      const leadId = typeof ctx.leadId === "string" ? ctx.leadId : null;
      const accountId = typeof ctx.accountId === "string" ? ctx.accountId : null;
      return {
        id: r.id,
        stage,
        channel,
        isExpected: r.isExpected,
        resolved: r.resolved,
        message: r.message,
        leadId,
        leadName: leadId ? leadNames[leadId] ?? null : null,
        accountId,
        accountLabel: accountId ? accountLabels[accountId] ?? null : null,
        occurredAt: r.createdAt.toISOString(),
      };
    }),
  };
}

export async function markOutreachErrorResolvedAction(id: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "errors", "edit");
  if (!permCheck.ok) return permCheck;

  const row = await db.errorLog.findFirst({ where: { id, tenantId: session.tenantId! } });
  if (!row) return { ok: false as const, error: "Error not found." };

  await db.errorLog.update({ where: { id }, data: { resolved: true } });
  return { ok: true as const };
}
