"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { TenantStatusBadge } from "@/components/ui/StatusBadge";
import { formatCents, formatDate } from "@/lib/utils";
import { Wrench } from "lucide-react";

interface TenantRow {
  id: string;
  companyName: string;
  status: string;
  planName: string | null;
  createdAt: string;
}

interface FlagRow {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
}

interface Props {
  maintenanceMode: boolean;
  killSwitchEnabled: boolean;
  defaultModel: string | null;
  dailyBudgetCents: number | null;
  flags: FlagRow[];
  tenants: TenantRow[];
}

export function ProductControlsClient({
  maintenanceMode,
  killSwitchEnabled,
  defaultModel,
  dailyBudgetCents,
  flags,
  tenants,
}: Props) {
  const [maintenance, setMaintenance] = useState(maintenanceMode);
  const [killSwitch, setKillSwitch] = useState(killSwitchEnabled);
  const [flagState, setFlagState] = useState(Object.fromEntries(flags.map((f) => [f.id, f.enabled])));

  const tenantColumns: Column<TenantRow>[] = [
    { key: "name", header: "Company", render: (t) => t.companyName },
    { key: "status", header: "Status", render: (t) => <TenantStatusBadge status={t.status} /> },
    { key: "plan", header: "Plan", render: (t) => t.planName ?? "—" },
    { key: "created", header: "Created", render: (t) => formatDate(t.createdAt) },
  ];

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5" /> Maintenance & Controls
          </CardTitle>
          <CardDescription>Product-level operational controls</CardDescription>
        </CardHeader>
        <div className="space-y-3">
          <Toggle
            checked={maintenance}
            onCheckedChange={setMaintenance}
            label="Maintenance Mode"
            description="Temporarily block tenant access while performing maintenance."
          />
          {defaultModel && (
            <Toggle
              checked={killSwitch}
              onCheckedChange={setKillSwitch}
              label="AI Emergency Kill Switch"
              description={`Default model: ${defaultModel}${dailyBudgetCents != null ? ` · Daily budget: ${formatCents(dailyBudgetCents)}` : ""}`}
            />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature Flags</CardTitle>
          <CardDescription>Flags scoped to this product</CardDescription>
        </CardHeader>
        <div className="space-y-3">
          {flags.map((f) => (
            <Toggle
              key={f.id}
              checked={flagState[f.id]}
              onCheckedChange={(v) => setFlagState((s) => ({ ...s, [f.id]: v }))}
              label={f.name}
              description={f.key}
            />
          ))}
          {flags.length === 0 && (
            <p className="py-4 text-center text-sm text-[var(--text-4)]">No product-scoped flags.</p>
          )}
        </div>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--text-1)]">Tenants on this product</h2>
        <DataTable columns={tenantColumns} data={tenants} rowKey={(t) => t.id} emptyMessage="No tenants yet." />
      </div>
    </>
  );
}
