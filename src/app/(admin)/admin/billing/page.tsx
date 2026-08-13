import { getBillingOverview } from "@/lib/mock/billing";
import { KpiCard } from "@/components/ui/KpiCard";
import { BillingTabsClient } from "./BillingTabsClient";
import { formatCents } from "@/lib/utils";
import { DollarSign, Receipt, RotateCcw, AlertTriangle } from "lucide-react";

export default async function BillingPage() {
  const { invoices, payments, refunds, pendingVerification, totalRevenue, totalRefunded, outstanding, overdue } =
    await getBillingOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Billing</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Revenue, invoices, payments, refunds, and renewals across all tenants.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Total Revenue" value={formatCents(totalRevenue)} icon={<DollarSign className="h-3.5 w-3.5" />} highlight />
        <KpiCard label="Outstanding" value={formatCents(outstanding)} icon={<Receipt className="h-3.5 w-3.5" />} />
        <KpiCard label="Total Refunded" value={formatCents(totalRefunded)} icon={<RotateCcw className="h-3.5 w-3.5" />} />
        <KpiCard label="Overdue Invoices" value={overdue.toString()} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
      </div>

      <BillingTabsClient
        invoices={invoices.map((i) => ({
          id: i.id,
          number: i.number,
          tenantName: i.tenant.companyName,
          amountCents: i.amountCents,
          status: i.status,
          dueDate: i.dueDate.toISOString(),
        }))}
        payments={payments.map((p) => ({
          id: p.id,
          tenantName: p.tenant.companyName,
          amountCents: p.amountCents,
          method: p.method,
          status: p.status,
          processedAt: p.processedAt.toISOString(),
        }))}
        refunds={refunds.map((r) => ({
          id: r.id,
          tenantName: r.tenant.companyName,
          amountCents: r.amountCents,
          reason: r.reason,
          status: r.status,
          requestedAt: r.requestedAt.toISOString(),
        }))}
        pendingVerification={pendingVerification.map((p) => ({
          id: p.id,
          tenantName: p.tenant.companyName,
          amountCents: p.amountCents,
          proofReference: p.proofReference,
          proofNote: p.proofNote,
          processedAt: p.processedAt.toISOString(),
        }))}
      />
    </div>
  );
}
