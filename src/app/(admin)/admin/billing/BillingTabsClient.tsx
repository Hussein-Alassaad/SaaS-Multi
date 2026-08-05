"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { InvoiceStatusBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { formatCents, formatDate } from "@/lib/utils";

interface InvoiceRow {
  id: string;
  number: string;
  tenantName: string;
  amountCents: number;
  status: string;
  dueDate: string;
}
interface PaymentRow {
  id: string;
  tenantName: string;
  amountCents: number;
  method: string;
  status: string;
  processedAt: string;
}
interface RefundRow {
  id: string;
  tenantName: string;
  amountCents: number;
  reason: string | null;
  status: string;
  requestedAt: string;
}

export function BillingTabsClient({
  invoices,
  payments,
  refunds,
}: {
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
}) {
  const invoiceColumns: Column<InvoiceRow>[] = [
    { key: "number", header: "Invoice", render: (i) => <span className="font-mono text-xs">{i.number}</span> },
    { key: "tenant", header: "Tenant", render: (i) => i.tenantName },
    { key: "amount", header: "Amount", render: (i) => formatCents(i.amountCents) },
    { key: "status", header: "Status", render: (i) => <InvoiceStatusBadge status={i.status} /> },
    { key: "due", header: "Due", render: (i) => formatDate(i.dueDate) },
  ];

  const paymentColumns: Column<PaymentRow>[] = [
    { key: "tenant", header: "Tenant", render: (p) => p.tenantName },
    { key: "amount", header: "Amount", render: (p) => formatCents(p.amountCents) },
    { key: "method", header: "Method", render: (p) => <Badge variant="outline">{p.method}</Badge> },
    {
      key: "status",
      header: "Status",
      render: (p) => <Badge variant={p.status === "SUCCEEDED" ? "success" : "hot"}>{p.status}</Badge>,
    },
    { key: "when", header: "Processed", render: (p) => formatDate(p.processedAt) },
  ];

  const refundColumns: Column<RefundRow>[] = [
    { key: "tenant", header: "Tenant", render: (r) => r.tenantName },
    { key: "amount", header: "Amount", render: (r) => formatCents(r.amountCents) },
    { key: "reason", header: "Reason", render: (r) => r.reason ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Badge variant={r.status === "COMPLETED" ? "success" : r.status === "REJECTED" ? "hot" : "warm"}>
          {r.status}
        </Badge>
      ),
    },
    { key: "when", header: "Requested", render: (r) => formatDate(r.requestedAt) },
  ];

  return (
    <Tabs defaultValue="invoices">
      <TabsList>
        <TabsTrigger value="invoices">Invoices</TabsTrigger>
        <TabsTrigger value="payments">Payments</TabsTrigger>
        <TabsTrigger value="refunds">Refunds</TabsTrigger>
      </TabsList>
      <TabsContent value="invoices">
        <DataTable columns={invoiceColumns} data={invoices} rowKey={(i) => i.id} />
      </TabsContent>
      <TabsContent value="payments">
        <DataTable columns={paymentColumns} data={payments} rowKey={(p) => p.id} />
      </TabsContent>
      <TabsContent value="refunds">
        <DataTable columns={refundColumns} data={refunds} rowKey={(r) => r.id} emptyMessage="No refunds issued." />
      </TabsContent>
    </Tabs>
  );
}
