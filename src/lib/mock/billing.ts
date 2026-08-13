import { db } from "@/lib/db";
import { safeJsonParse } from "@/lib/utils";

export async function getPlans() {
  const plans = await db.plan.findMany({ include: { subscriptions: true }, orderBy: { monthlyPrice: "asc" } });
  return plans.map((p) => ({
    ...p,
    features: safeJsonParse<string[]>(p.features, []),
    activeSubCount: p.subscriptions.filter((s) => s.status === "ACTIVE").length,
  }));
}

export async function getBillingOverview() {
  const [invoices, payments, refunds, pendingVerification] = await Promise.all([
    db.invoice.findMany({ include: { tenant: true }, orderBy: { issuedAt: "desc" } }),
    db.payment.findMany({ include: { tenant: true }, orderBy: { processedAt: "desc" } }),
    db.refund.findMany({ include: { tenant: true }, orderBy: { requestedAt: "desc" } }),
    db.payment.findMany({
      where: { method: "omt_wish", status: "PENDING" },
      include: { tenant: true },
      orderBy: { processedAt: "asc" },
    }),
  ]);

  const totalRevenue = payments.filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + p.amountCents, 0);
  const totalRefunded = refunds
    .filter((r) => r.status === "COMPLETED")
    .reduce((s, r) => s + r.amountCents, 0);
  const outstanding = invoices.filter((i) => i.status === "OPEN").reduce((s, i) => s + i.amountCents, 0);
  const overdue = invoices.filter((i) => i.status === "OPEN" && i.dueDate < new Date()).length;

  return { invoices, payments, refunds, pendingVerification, totalRevenue, totalRefunded, outstanding, overdue };
}
