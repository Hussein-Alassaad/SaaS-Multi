"use server";

import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import {
  getClientsList,
  getClientHistoryList,
  getClientHistoryExportRows,
  getLeadReplies,
} from "@/lib/outreach/clients";
import { safeJsonParse } from "@/lib/utils";

function serializeClient(lead: Awaited<ReturnType<typeof getClientsList>>["items"][number]) {
  return {
    id: lead.id,
    businessName: lead.businessName,
    platform: lead.platform,
    industry: lead.industry,
    score: lead.score,
    temperature: lead.temperature,
    status: lead.status,
    founderFound: lead.founderFound,
    founderName: lead.founderName,
    whatsappFound: lead.whatsappFound,
    whatsappNumber: lead.whatsappNumber,
    contactCount: lead.contactCount,
    createdAt: lead.createdAt.toISOString(),
  };
}

function serializeHistoryRow(row: Awaited<ReturnType<typeof getClientHistoryList>>["items"][number]) {
  return {
    id: row.id,
    leadId: row.leadId,
    businessName: row.businessName,
    contacted: row.contacted,
    temperature: row.temperature,
    platform: row.platform,
    industry: row.industry,
    score: row.score,
  };
}

export async function loadMoreClientsAction(cursor: string, search?: string, filter?: "all" | "numbers") {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "clients", "view");
  if (!permCheck.ok) return permCheck;

  const { items, nextCursor } = await getClientsList(session.tenantId!, { cursor, search, filter });
  return { ok: true as const, nextCursor, clients: items.map(serializeClient) };
}

export async function loadMoreClientHistoryAction(cursor: string, search?: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "client-history", "view");
  if (!permCheck.ok) return permCheck;

  const { items, nextCursor } = await getClientHistoryList(session.tenantId!, { cursor, search });
  return { ok: true as const, nextCursor, rows: items.map(serializeHistoryRow) };
}

export async function getLeadRepliesAction(leadId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "client-history", "view");
  if (!permCheck.ok) return permCheck;

  const { replies, accountLabels } = await getLeadReplies(session.tenantId!, leadId);
  return {
    ok: true as const,
    replies: replies.map((r) => ({
      id: r.id,
      channel: r.channel,
      body: r.body,
      accountId: r.accountId,
      repliedAt: r.repliedAt.toISOString(),
    })),
    accountLabels,
  };
}

export async function exportClientHistoryCsvAction(search?: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "client-history", "view");
  if (!permCheck.ok) return permCheck;

  const rows = await getClientHistoryExportRows(session.tenantId!, search);
  return {
    ok: true as const,
    rows: rows.map((row) => ({
      id: row.id,
      businessName: row.businessName,
      platform: row.platform,
      industry: row.industry,
      score: row.score,
      temperature: row.temperature,
      contacted: row.contacted,
      founderName: row.founderName,
      snapshot: safeJsonParse<Record<string, unknown>>(row.snapshot, {}),
    })),
  };
}
