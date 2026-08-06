"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { TenantStatusBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { formatCents, formatDate } from "@/lib/utils";
import { useUiStore } from "@/lib/store/ui";
import { startImpersonationAction } from "@/lib/actions/impersonation";
import { UserCog } from "lucide-react";

interface TenantRow {
  id: string;
  companyName: string;
  subdomain: string;
  status: string;
  storageUsedMb: number;
  aiCreditsUsed: number;
  createdAt: string;
  productName: string;
  ownerName: string | null;
  planName: string | null;
  planPrice: number | null;
}

export function TenantsTableClient({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter();
  const startImpersonation = useUiStore((s) => s.startImpersonation);
  const [search, setSearch] = useState("");

  const filtered = tenants.filter(
    (t) =>
      t.companyName.toLowerCase().includes(search.toLowerCase()) ||
      t.subdomain.toLowerCase().includes(search.toLowerCase())
  );

  const columns: Column<TenantRow>[] = [
    {
      key: "company",
      header: "Company",
      render: (t) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={t.companyName} size="sm" />
          <div className="min-w-0">
            <div className="font-medium text-[var(--text-1)] truncate">{t.companyName}</div>
            <div className="text-xs text-[var(--text-5)]">{t.subdomain}.example.com</div>
          </div>
        </div>
      ),
    },
    {
      key: "product",
      header: "Product",
      render: (t) => <Badge variant="outline">{t.productName}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (t) => <TenantStatusBadge status={t.status} />,
    },
    {
      key: "plan",
      header: "Plan",
      render: (t) => (
        <span>
          {t.planName ?? "—"}
          {t.planPrice != null && (
            <span className="text-[var(--text-5)]"> · {formatCents(t.planPrice)}/mo</span>
          )}
        </span>
      ),
    },
    {
      key: "storage",
      header: "Storage",
      render: (t) => <span>{(t.storageUsedMb / 1024).toFixed(1)} GB</span>,
    },
    {
      key: "ai",
      header: "AI Credits Used",
      render: (t) => <span>{t.aiCreditsUsed.toLocaleString()}</span>,
    },
    {
      key: "created",
      header: "Created",
      render: (t) => <span className="text-[var(--text-4)]">{formatDate(t.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (t) => (
        <Button
          size="sm"
          variant="outline"
          onClick={async (e) => {
            e.stopPropagation();
            const result = await startImpersonationAction(t.id);
            startImpersonation(t.id, t.companyName, result.ok ? result.sessionId : null);
          }}
        >
          <UserCog className="h-3.5 w-3.5" />
          Login as
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Search tenants..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <span className="text-xs text-[var(--text-4)]">{filtered.length} tenants</span>
      </div>
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(t) => t.id}
        onRowClick={(t) => router.push(`/admin/tenants/${t.id}`)}
        emptyMessage="No tenants match your search."
      />
    </div>
  );
}
