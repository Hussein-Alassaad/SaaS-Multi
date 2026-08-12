"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Drawer } from "@/components/ui/Drawer";
import { formatDate } from "@/lib/utils";
import { updateFeatureRequestStatusAction } from "@/lib/actions/feature-requests";

interface FeatureRequestRow {
  id: string;
  title: string;
  description: string;
  status: string;
  tenantName: string;
  filedByName: string | null;
  createdAt: string;
}

const STATUS_OPTIONS = ["NEW", "UNDER_REVIEW", "PLANNED", "COMPLETED", "REJECTED"];

const STATUS_VARIANT: Record<string, "neutral" | "warm" | "accent" | "success" | "hot"> = {
  NEW: "neutral",
  UNDER_REVIEW: "warm",
  PLANNED: "accent",
  COMPLETED: "success",
  REJECTED: "hot",
};

export function FeatureRequestsClient({ requests }: { requests: FeatureRequestRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<FeatureRequestRow | null>(null);
  const [pending, startTransition] = useTransition();

  const handleStatusChange = (id: string, status: string) => {
    startTransition(async () => {
      await updateFeatureRequestStatusAction(id, status as never);
      router.refresh();
    });
  };

  const columns: Column<FeatureRequestRow>[] = [
    {
      key: "title",
      header: "Request",
      render: (r) => (
        <button className="text-left" onClick={() => setSelected(r)}>
          <p className="font-medium text-[var(--text-1)] hover:underline">{r.title}</p>
          <p className="text-xs text-[var(--text-5)] truncate max-w-xs">{r.description}</p>
        </button>
      ),
    },
    { key: "tenant", header: "Tenant", render: (r) => r.tenantName },
    { key: "filedBy", header: "Filed By", render: (r) => r.filedByName ?? "—" },
    { key: "date", header: "Date", render: (r) => formatDate(r.createdAt) },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <Select
          value={r.status}
          onValueChange={(v) => handleStatusChange(r.id, v)}
          options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
          className="w-40"
        />
      ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={requests} rowKey={(r) => r.id} emptyMessage="No feature requests yet." />

      <Drawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)} title={selected?.title ?? ""}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={STATUS_VARIANT[selected.status] ?? "neutral"}>{selected.status.replace(/_/g, " ")}</Badge>
              <span className="text-xs text-[var(--text-5)]">{selected.tenantName}</span>
            </div>
            <p className="text-sm text-[var(--text-2)] whitespace-pre-line">{selected.description}</p>
            <p className="text-xs text-[var(--text-5)]">
              Filed by {selected.filedByName ?? "—"} · {formatDate(selected.createdAt)}
            </p>
            <Select
              value={selected.status}
              onValueChange={(v) => {
                handleStatusChange(selected.id, v);
                setSelected({ ...selected, status: v });
              }}
              options={STATUS_OPTIONS.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))}
              className="w-full"
            />
            {pending && <p className="text-xs text-[var(--text-5)]">Saving…</p>}
          </div>
        )}
      </Drawer>
    </>
  );
}
