import { notFound } from "next/navigation";
import { getTenantDetail } from "@/lib/mock/tenants";
import { TenantDetailClient } from "./TenantDetailClient";
import { safeJsonParse } from "@/lib/utils";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const result = await getTenantDetail(tenantId);
  if (!result) notFound();

  const { tenant, flags, sections } = result;

  const serialized = {
    id: tenant.id,
    companyName: tenant.companyName,
    subdomain: tenant.subdomain,
    status: tenant.status,
    storageUsedMb: tenant.storageUsedMb,
    aiCreditsUsed: tenant.aiCreditsUsed,
    createdAt: tenant.createdAt.toISOString(),
    product: { id: tenant.product.id, name: tenant.product.name, slug: tenant.product.slug },
    owner: tenant.owner ? { id: tenant.owner.id, name: tenant.owner.name, email: tenant.owner.email } : null,
    users: tenant.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      status: u.status,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    })),
    subscriptions: tenant.subscriptions.map((s) => ({
      id: s.id,
      status: s.status,
      billingCycle: s.billingCycle,
      trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
      gracePeriodEndsAt: s.gracePeriodEndsAt?.toISOString() ?? null,
      currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
      plan: {
        name: s.plan.name,
        monthlyPrice: s.plan.monthlyPrice,
        yearlyPrice: s.plan.yearlyPrice,
        maxUsers: s.plan.maxUsers,
        storageLimitMb: s.plan.storageLimitMb,
        aiCredits: s.plan.aiCredits,
        features: safeJsonParse<string[]>(s.plan.features, []),
      },
    })),
    invoices: tenant.invoices.map((i) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      amountCents: i.amountCents,
      dueDate: i.dueDate.toISOString(),
      issuedAt: i.issuedAt.toISOString(),
      paidAt: i.paidAt?.toISOString() ?? null,
    })),
    payments: tenant.payments.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      status: p.status,
      method: p.method,
      processedAt: p.processedAt.toISOString(),
      refunds: p.refunds.map((r) => ({ id: r.id, amountCents: r.amountCents, status: r.status })),
    })),
    aiUsageLogs: tenant.aiUsageLogs.map((l) => ({
      id: l.id,
      model: l.model,
      tokens: l.tokens,
      costCents: l.costCents,
      responseTimeMs: l.responseTimeMs,
      success: l.success,
      createdAt: l.createdAt.toISOString(),
    })),
    supportTickets: tenant.supportTickets.map((t) => ({
      id: t.id,
      subject: t.subject,
      type: t.type,
      priority: t.priority,
      status: t.status,
      assigneeName: t.assignee?.name ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
    auditLogs: tenant.auditLogs.map((a) => ({
      id: a.id,
      action: a.action,
      actorName: a.actor?.name ?? "System",
      ip: a.ip,
      device: a.device,
      browser: a.browser,
      createdAt: a.createdAt.toISOString(),
    })),
    impersonationSessions: tenant.impersonationSessions.map((s) => ({
      id: s.id,
      adminName: s.admin.name,
      reason: s.reason,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt?.toISOString() ?? null,
    })),
    flags: flags.map((f) => ({
      id: f.id,
      key: f.key,
      name: f.name,
      scope: f.scope,
      enabled: f.enabled,
    })),
    sections,
    outreachAccounts: tenant.outreachAccounts.map((a) => ({
      id: a.id,
      label: a.label,
      platform: a.platform,
      igDailyLimit: a.igDailyLimit,
      linkedinDailyLimit: a.linkedinDailyLimit,
      emailDailyLimit: a.emailDailyLimit,
      status: a.status,
    })),
    outreachTimezone: tenant.outreachSettings?.timezone ?? null,
  };

  return <TenantDetailClient tenant={serialized} />;
}
