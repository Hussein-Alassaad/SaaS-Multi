"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Badge } from "@/components/ui/Badge";
import type { TenantOutreachPerformance } from "@/lib/outreach/admin-performance";

type SortKey = "replyRate" | "messageRate" | "dealRate" | "totalLeads";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "dealRate", label: "Deal rate" },
  { key: "replyRate", label: "Reply rate" },
  { key: "messageRate", label: "Message rate" },
  { key: "totalLeads", label: "Total leads" },
];

function rateVariant(rate: number): "success" | "warm" | "neutral" {
  if (rate >= 20) return "success";
  if (rate >= 5) return "warm";
  return "neutral";
}

export function OutreachPerformanceClient({ rows }: { rows: TenantOutreachPerformance[] }) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("dealRate");

  const sorted = useMemo(() => [...rows].sort((a, b) => b[sortKey] - a[sortKey]), [rows, sortKey]);

  const platformTotals = useMemo(() => {
    const totalLeads = rows.reduce((sum, r) => sum + r.totalLeads, 0);
    const contacted = rows.reduce((sum, r) => sum + r.contacted, 0);
    const replied = rows.reduce((sum, r) => sum + r.replied, 0);
    const dealsClosed = rows.reduce((sum, r) => sum + r.dealsClosed, 0);
    return {
      totalLeads,
      contacted,
      dealsClosed,
      replyRate: contacted > 0 ? Math.round((replied / contacted) * 100) : 0,
      messageRate: totalLeads > 0 ? Math.round((contacted / totalLeads) * 100) : 0,
      dealRate: contacted > 0 ? Math.round((dealsClosed / contacted) * 100) : 0,
    };
  }, [rows]);

  const columns: Column<TenantOutreachPerformance>[] = [
    {
      key: "company",
      header: "Client",
      render: (r) => <div className="font-medium text-[var(--text-1)]">{r.companyName}</div>,
    },
    {
      key: "totalLeads",
      header: "Total leads",
      render: (r) => <span className="tabular-nums text-[var(--text-3)]">{r.totalLeads}</span>,
    },
    {
      key: "contacted",
      header: "Contacted",
      render: (r) => <span className="tabular-nums text-[var(--text-3)]">{r.contacted}</span>,
    },
    {
      key: "replied",
      header: "Replied",
      render: (r) => <span className="tabular-nums text-[var(--text-3)]">{r.replied}</span>,
    },
    {
      key: "messageRate",
      header: "Message rate",
      render: (r) => <Badge variant={rateVariant(r.messageRate)}>{r.messageRate}%</Badge>,
    },
    {
      key: "replyRate",
      header: "Reply rate",
      render: (r) => <Badge variant={rateVariant(r.replyRate)}>{r.replyRate}%</Badge>,
    },
    {
      key: "dealsClosed",
      header: "Deals closed",
      render: (r) => <span className="tabular-nums text-[var(--text-3)]">{r.dealsClosed}</span>,
    },
    {
      key: "dealRate",
      header: "Deal rate",
      render: (r) => <Badge variant={rateVariant(r.dealRate)}>{r.dealRate}%</Badge>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Clients" value={String(rows.length)} />
        <KpiCard label="Total leads" value={String(platformTotals.totalLeads)} />
        <KpiCard label="Contacted" value={String(platformTotals.contacted)} />
        <KpiCard label="Message rate" value={`${platformTotals.messageRate}%`} />
        <KpiCard label="Reply rate" value={`${platformTotals.replyRate}%`} />
        <KpiCard label="Deal rate" value={`${platformTotals.dealRate}%`} highlight />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-[var(--text-5)]">Sort by:</span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSortKey(s.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)] ${
              sortKey === s.key
                ? "bg-gradient-to-r from-[var(--accent-from)]/25 to-[var(--accent-to)]/15 text-[var(--text-1)] ring-1 ring-[var(--accent-from)]/30"
                : "text-[var(--text-5)] hover:text-[var(--text-3)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={sorted}
        rowKey={(r) => r.tenantId}
        onRowClick={(r) => router.push(`/admin/tenants/${r.tenantId}`)}
        emptyMessage="No Outreach clients yet."
      />
    </div>
  );
}
