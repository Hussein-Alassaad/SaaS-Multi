"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { InvoiceStatusBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCents, formatDate } from "@/lib/utils";
import { approvePaymentAction, rejectPaymentAction } from "@/lib/actions/payment-review";

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
interface PendingVerificationRow {
  id: string;
  tenantName: string;
  amountCents: number;
  proofReference: string | null;
  proofNote: string | null;
  processedAt: string;
}

export function BillingTabsClient({
  invoices,
  payments,
  refunds,
  pendingVerification,
}: {
  invoices: InvoiceRow[];
  payments: PaymentRow[];
  refunds: RefundRow[];
  pendingVerification: PendingVerificationRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actioningId, setActioningId] = useState<string | null>(null);

  const handleApprove = (id: string) => {
    setActioningId(id);
    startTransition(async () => {
      await approvePaymentAction(id);
      router.refresh();
      setActioningId(null);
    });
  };

  const handleReject = (id: string) => {
    setActioningId(id);
    startTransition(async () => {
      await rejectPaymentAction(id);
      router.refresh();
      setActioningId(null);
    });
  };
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

  const pendingColumns: Column<PendingVerificationRow>[] = [
    { key: "tenant", header: "Tenant", render: (p) => p.tenantName },
    { key: "amount", header: "Amount", render: (p) => formatCents(p.amountCents) },
    {
      key: "reference",
      header: "Reference",
      render: (p) => <span className="font-mono text-xs">{p.proofReference ?? "—"}</span>,
    },
    { key: "note", header: "Note", render: (p) => p.proofNote ?? "—" },
    { key: "submitted", header: "Submitted", render: (p) => formatDate(p.processedAt) },
    {
      key: "actions",
      header: "",
      render: (p) => (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={pending && actioningId === p.id}
            onClick={() => handleApprove(p.id)}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending && actioningId === p.id}
            onClick={() => handleReject(p.id)}
          >
            Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Tabs defaultValue={pendingVerification.length > 0 ? "pending" : "invoices"}>
      <TabsList>
        <TabsTrigger value="pending">
          Pending Verification{pendingVerification.length > 0 ? ` (${pendingVerification.length})` : ""}
        </TabsTrigger>
        <TabsTrigger value="invoices">Invoices</TabsTrigger>
        <TabsTrigger value="payments">Payments</TabsTrigger>
        <TabsTrigger value="refunds">Refunds</TabsTrigger>
      </TabsList>
      <TabsContent value="pending">
        <DataTable
          columns={pendingColumns}
          data={pendingVerification}
          rowKey={(p) => p.id}
          emptyMessage="No OMT/Wish payments awaiting verification."
        />
      </TabsContent>
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
