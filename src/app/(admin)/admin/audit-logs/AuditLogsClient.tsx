"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { formatDateTime } from "@/lib/utils";

interface AuditRow {
  id: string;
  action: string;
  actorName: string;
  tenantName: string | null;
  ip: string | null;
  device: string | null;
  browser: string | null;
  createdAt: string;
}

export function AuditLogsClient({ logs }: { logs: AuditRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = logs.filter(
    (l) =>
      l.action.toLowerCase().includes(search.toLowerCase()) ||
      l.actorName.toLowerCase().includes(search.toLowerCase()) ||
      (l.tenantName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const columns: Column<AuditRow>[] = [
    {
      key: "action",
      header: "Action",
      render: (l) => (
        <Badge variant="outline" className="font-mono text-[11px]">
          {l.action}
        </Badge>
      ),
    },
    { key: "actor", header: "Actor", render: (l) => l.actorName },
    { key: "tenant", header: "Tenant", render: (l) => l.tenantName ?? "—" },
    { key: "ip", header: "IP", render: (l) => <span className="font-mono text-xs">{l.ip ?? "—"}</span> },
    { key: "device", header: "Device", render: (l) => `${l.device ?? "—"} · ${l.browser ?? "—"}` },
    { key: "when", header: "Timestamp", render: (l) => formatDateTime(l.createdAt) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Search by action, actor, or tenant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-xs text-[var(--text-4)]">{filtered.length} events</span>
      </div>
      <DataTable columns={columns} data={filtered} rowKey={(l) => l.id} />
    </div>
  );
}
