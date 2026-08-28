import { withPlatformAccess } from "@/lib/db";
import { safeJsonParse } from "@/lib/utils";

export async function getPlans() {
  // Plan itself is not tenant-scoped, but the `subscriptions` include is an
  // RLS table -- without platform context every plan would come back with an
  // empty subscriptions array and activeSubCount would always be 0.
  const plans = await withPlatformAccess((tx) =>
    tx.plan.findMany({ include: { subscriptions: true }, orderBy: { monthlyPrice: "asc" } })
  );
  return plans.map((p) => ({
    ...p,
    features: safeJsonParse<string[]>(p.features, []),
    activeSubCount: p.subscriptions.filter((s) => s.status === "ACTIVE").length,
  }));
}

export async function getBillingOverview() {
  const { invoices, payments, refunds, pendingVerification } = await withPlatformAccess(async (tx) => {
    const invoices = await tx.invoice.findMany({ include: { tenant: true }, orderBy: { issuedAt: "desc" } });
    const payments = await tx.payment.findMany({ include: { tenant: true }, orderBy: { processedAt: "desc" } });
    const refunds = await tx.refund.findMany({ include: { tenant: true }, orderBy: { requestedAt: "desc" } });
    const pendingVerification = await tx.payment.findMany({
      where: { method: "omt_wish", status: "PENDING" },
      include: { tenant: true },
      orderBy: { processedAt: "asc" },
    });
    return { invoices, payments, refunds, pendingVerification };
  });

  const totalRevenue = payments.filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + p.amountCents, 0);
  const totalRefunded = refunds
    .filter((r) => r.status === "COMPLETED")
    .reduce((s, r) => s + r.amountCents, 0);
  const outstanding = invoices.filter((i) => i.status === "OPEN").reduce((s, i) => s + i.amountCents, 0);
  const overdue = invoices.filter((i) => i.status === "OPEN" && i.dueDate < new Date()).length;

  return { invoices, payments, refunds, pendingVerification, totalRevenue, totalRefunded, outstanding, overdue };
}
