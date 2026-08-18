"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";
import { markErrorLogResolvedAction } from "@/lib/actions/error-logs";

interface ErrorLogRow {
  id: string;
  source: string;
  message: string;
  tenantName: string | null;
  resolved: boolean;
  context: string | null;
  createdAt: string;
}

export function ErrorLogsClient({ logs }: { logs: ErrorLogRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const filtered = logs.filter(
    (l) =>
      (showResolved || !l.resolved) &&
      (l.source.toLowerCase().includes(search.toLowerCase()) ||
        l.message.toLowerCase().includes(search.toLowerCase()) ||
        (l.tenantName ?? "").toLowerCase().includes(search.toLowerCase()))
  );

  const handleToggleResolved = (id: string, resolved: boolean) => {
    setPendingId(id);
    startTransition(async () => {
      await markErrorLogResolvedAction(id, resolved);
      router.refresh();
      setPendingId(null);
    });
  };

  const columns: Column<ErrorLogRow>[] = [
    {
      key: "source",
      header: "Source",
      render: (l) => (
        <Badge variant="outline" className="font-mono text-[11px]">
          {l.source}
        </Badge>
      ),
    },
    { key: "message", header: "Message", render: (l) => <span className="text-xs">{l.message}</span> },
    { key: "tenant", header: "Tenant", render: (l) => l.tenantName ?? "—" },
    {
      key: "status",
      header: "Status",
      render: (l) => (l.resolved ? <Badge variant="success">Resolved</Badge> : <Badge variant="hot">Open</Badge>),
    },
    { key: "when", header: "Timestamp", render: (l) => formatDateTime(l.createdAt) },
    {
      key: "actions",
      header: "",
      render: (l) => (
        <Button
          size="sm"
          variant="outline"
          disabled={pendingId === l.id}
          onClick={() => handleToggleResolved(l.id, !l.resolved)}
        >
          {l.resolved ? "Reopen" : "Mark resolved"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Search by source, message, or tenant..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="text-xs font-medium text-[var(--text-4)] hover:text-[var(--text-2)]"
          >
            {showResolved ? "Hide resolved" : "Show resolved"}
          </button>
          <span className="text-xs text-[var(--text-4)]">{filtered.length} errors</span>
        </div>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(l) => l.id}
        emptyMessage="No errors logged — everything's running clean."
      />
    </div>
  );
}
