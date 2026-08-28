"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { getLiveFeed, getPipelineColumn, type PipelineStage } from "@/lib/outreach/leads";
import { safeJsonParse } from "@/lib/utils";

function serializeLead(lead: Awaited<ReturnType<typeof getLiveFeed>>["items"][number]) {
  return {
    id: lead.id,
    platform: lead.platform,
    businessName: lead.businessName,
    industry: lead.industry,
    score: lead.score,
    temperature: lead.temperature,
    founderFound: lead.founderFound,
    founderName: lead.founderName,
    weakPoints: safeJsonParse<string[]>(lead.weakPoints, []),
    generatedMessage: lead.generatedMessage,
    status: lead.status,
    createdAt: lead.createdAt.toISOString(),
    account: lead.account ? { id: lead.account.id, label: lead.account.label } : null,
  };
}

export async function loadMoreLiveFeedAction(cursor: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "dashboard", "view");
  if (!permCheck.ok) return permCheck;

  const { items, nextCursor } = await getLiveFeed(session.tenantId!, cursor);
  return { ok: true as const, nextCursor, leads: items.map(serializeLead) };
}

export async function loadMorePipelineStageAction(stage: PipelineStage, limit: number) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "pipeline", "view");
  if (!permCheck.ok) return permCheck;

  const leads = await getPipelineColumn(session.tenantId!, stage, limit);
  return { ok: true as const, leads };
}

export async function moveLeadStageAction(leadId: string, toStage: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "pipeline", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const lead = await tx.outreachLead.findFirst({ where: { id: leadId, tenantId: session.tenantId! } });
    if (!lead) return false;

    // Was a db.$transaction([...]) array before RLS -- sequential against the
    // same `tx` now, still one atomic transaction.
    await tx.outreachLead.update({ where: { id: leadId }, data: { status: toStage } });
    await tx.outreachPipelineHistory.create({
      data: {
        tenantId: session.tenantId!,
        leadId,
        fromStage: lead.status,
        toStage,
        changedBy: session.id,
      },
    });
    return true;
  });
  if (!found) return { ok: false as const, error: "Lead not found." };

  return { ok: true as const };
}
