"use server";

import { addDays, addMonths } from "date-fns";
import { db, withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { readAnalyticsSummary } from "@/lib/agency/settings";
import { revalidatePath } from "next/cache";

/**
 * Data for a client-side PDF export (see AnalyticsExportControls.tsx, which
 * renders this with jsPDF) -- the same summary the Analytics page already
 * shows, so the export always matches what the tenant is looking at.
 */
export async function getAnalyticsExportDataAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "analytics", "view");
  if (!permCheck.ok) return permCheck;

  const summary = await withTenant(session.tenantId!, async (tx) => {
    const data = await readAnalyticsSummary(tx, session.tenantId!);
    await tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "analytics.exported",
        resource: "analytics",
        tenantId: session.tenantId,
        device: "Desktop",
        browser: "Agency OS",
      },
    });
    return data;
  });

  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId! }, select: { companyName: true } });
  return { ok: true as const, summary, tenantName: tenant?.companyName ?? "" };
}

export type ReportFrequency = "weekly" | "monthly";
export type ReportType = "analytics" | "campaigns" | "contacts";

export interface ScheduleReportInput {
  name: string;
  frequency: ReportFrequency;
  recipients: string[];
  reportType: ReportType;
}

function computeNextRunAt(frequency: ReportFrequency): Date {
  const now = new Date();
  return frequency === "weekly" ? addDays(now, 7) : addMonths(now, 1);
}

export async function scheduleReportAction(input: ScheduleReportInput) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "analytics", "edit");
  if (!permCheck.ok) return permCheck;

  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name is required." };

  const recipients = input.recipients.map((r) => r.trim()).filter(Boolean);
  if (recipients.length === 0) return { ok: false as const, error: "Add at least one recipient email." };
  const invalid = recipients.find((r) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  if (invalid) return { ok: false as const, error: `"${invalid}" is not a valid email address.` };

  const created = await withTenant(session.tenantId!, (tx) =>
    tx.scheduledReport.create({
      data: {
        tenantId: session.tenantId!,
        name,
        frequency: input.frequency,
        recipients: JSON.stringify(recipients),
        reportType: input.reportType,
        nextRunAt: computeNextRunAt(input.frequency),
        createdById: session.id,
      },
    })
  );

  revalidatePath("/agency/analytics");
  return { ok: true as const, report: created };
}

export async function listScheduledReportsAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "analytics", "view");
  if (!permCheck.ok) return permCheck;

  const reports = await withTenant(session.tenantId!, (tx) =>
    tx.scheduledReport.findMany({ where: { tenantId: session.tenantId! }, orderBy: { createdAt: "desc" } })
  );

  return {
    ok: true as const,
    reports: reports.map((r) => ({
      id: r.id,
      name: r.name,
      frequency: r.frequency,
      recipients: JSON.parse(r.recipients) as string[],
      reportType: r.reportType,
      nextRunAt: r.nextRunAt.toISOString(),
    })),
  };
}

export async function deleteScheduledReportAction(reportId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "analytics", "edit");
  if (!permCheck.ok) return permCheck;

  const deleted = await withTenant(session.tenantId!, async (tx) => {
    const existing = await tx.scheduledReport.findFirst({ where: { id: reportId, tenantId: session.tenantId! } });
    if (!existing) return false;
    await tx.scheduledReport.delete({ where: { id: reportId } });
    return true;
  });

  if (!deleted) return { ok: false as const, error: "Scheduled report not found." };

  revalidatePath("/agency/analytics");
  return { ok: true as const };
}
