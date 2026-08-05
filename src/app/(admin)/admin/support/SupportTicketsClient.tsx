"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { TicketStatusBadge, PriorityBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { timeAgo } from "@/lib/utils";

interface TicketRow {
  id: string;
  subject: string;
  tenantName: string;
  type: string;
  priority: string;
  status: string;
  assigneeName: string | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  BUG: "Bug",
  FEATURE_REQUEST: "Feature Request",
  FEEDBACK: "Feedback",
  QUESTION: "Question",
  BILLING: "Billing",
};

export function SupportTicketsClient({ tickets }: { tickets: TicketRow[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");

  const filtered = tickets.filter((t) => {
    const matchesSearch =
      t.subject.toLowerCase().includes(search.toLowerCase()) ||
      t.tenantName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || t.status === statusFilter;
    const matchesType = typeFilter === "ALL" || t.type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const columns: Column<TicketRow>[] = [
    { key: "subject", header: "Subject", render: (t) => <span className="font-medium text-[var(--text-1)]">{t.subject}</span> },
    { key: "tenant", header: "Tenant", render: (t) => t.tenantName },
    { key: "type", header: "Type", render: (t) => <Badge variant="outline">{TYPE_LABELS[t.type] ?? t.type}</Badge> },
    { key: "priority", header: "Priority", render: (t) => <PriorityBadge priority={t.priority} /> },
    { key: "status", header: "Status", render: (t) => <TicketStatusBadge status={t.status} /> },
    { key: "assignee", header: "Assignee", render: (t) => t.assigneeName ?? "Unassigned" },
    { key: "created", header: "Created", render: (t) => timeAgo(t.createdAt) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search tickets..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={[
            { value: "ALL", label: "All statuses" },
            { value: "OPEN", label: "Open" },
            { value: "IN_PROGRESS", label: "In Progress" },
            { value: "WAITING_ON_CUSTOMER", label: "Waiting on Customer" },
            { value: "RESOLVED", label: "Resolved" },
            { value: "CLOSED", label: "Closed" },
          ]}
          className="w-48"
        />
        <Select
          value={typeFilter}
          onValueChange={setTypeFilter}
          options={[
            { value: "ALL", label: "All types" },
            ...Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
          className="w-44"
        />
        <span className="text-xs text-[var(--text-4)]">{filtered.length} tickets</span>
      </div>
      <DataTable columns={columns} data={filtered} rowKey={(t) => t.id} />
    </div>
  );
}
