"use client";

import { useState, useTransition } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatCents, timeAgo } from "@/lib/utils";
import { AI_MODELS } from "@/types/ai";
import { AlertTriangle, Power } from "lucide-react";
import { updateGlobalAiSettingsAction, setAiKillSwitchAction } from "@/lib/actions/ai";

interface ProductBudget {
  id: string;
  dailyBudgetCents: number;
  monthlyBudgetCents: number;
  rateLimitPerMin: number;
  defaultModel: string;
  killSwitchEnabled: boolean;
}

interface AiLogRow {
  id: string;
  tenant: { companyName: string };
  product: { name: string };
  model: string;
  tokens: number;
  costCents: number;
  responseTimeMs: number;
  success: boolean;
  createdAt: string | Date;
}

interface Props {
  globalBudget: {
    id: string;
    dailyBudgetCents: number;
    monthlyBudgetCents: number;
    rateLimitPerMin: number;
    defaultModel: string;
    cachingEnabled: boolean;
    killSwitchEnabled: boolean;
  } | null;
  productBudgets: ProductBudget[];
  logs: AiLogRow[];
}

export function AiControlClient({ globalBudget, productBudgets, logs }: Props) {
  const [defaultModel, setDefaultModel] = useState(globalBudget?.defaultModel ?? "gpt-4o-mini");
  const [dailyBudget, setDailyBudget] = useState(((globalBudget?.dailyBudgetCents ?? 0) / 100).toString());
  const [monthlyBudget, setMonthlyBudget] = useState(((globalBudget?.monthlyBudgetCents ?? 0) / 100).toString());
  const [rateLimit, setRateLimit] = useState((globalBudget?.rateLimitPerMin ?? 60).toString());
  const [cachingEnabled, setCachingEnabled] = useState(globalBudget?.cachingEnabled ?? true);
  const [killSwitch, setKillSwitch] = useState(globalBudget?.killSwitchEnabled ?? false);
  const [isSaving, startSaveTransition] = useTransition();
  const [isTogglingKillSwitch, startKillSwitchTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaveError(null);
    setSaved(false);
    startSaveTransition(async () => {
      const result = await updateGlobalAiSettingsAction({
        defaultModel,
        dailyBudgetCents: Math.round(Number(dailyBudget) * 100),
        monthlyBudgetCents: Math.round(Number(monthlyBudget) * 100),
        rateLimitPerMin: Math.round(Number(rateLimit)),
        cachingEnabled,
      });
      if (!result.ok) {
        setSaveError(result.error ?? "Failed to save.");
      } else {
        setSaved(true);
      }
    });
  };

  const handleKillSwitchToggle = () => {
    const next = !killSwitch;
    setSaveError(null);
    startKillSwitchTransition(async () => {
      const result = await setAiKillSwitchAction(next);
      if (result.ok) {
        setKillSwitch(next);
      } else {
        setSaveError(result.error ?? "Failed to update kill switch.");
      }
    });
  };

  const logColumns: Column<AiLogRow>[] = [
    { key: "tenant", header: "Tenant", render: (l) => l.tenant.companyName },
    { key: "product", header: "Product", render: (l) => <Badge variant="outline">{l.product.name}</Badge> },
    { key: "model", header: "Model", render: (l) => l.model },
    { key: "tokens", header: "Tokens", render: (l) => l.tokens.toLocaleString() },
    { key: "cost", header: "Cost", render: (l) => formatCents(l.costCents) },
    { key: "latency", header: "Latency", render: (l) => `${l.responseTimeMs}ms` },
    {
      key: "status",
      header: "Status",
      render: (l) => <Badge variant={l.success ? "success" : "hot"}>{l.success ? "OK" : "Error"}</Badge>,
    },
    { key: "when", header: "When", render: (l) => timeAgo(l.createdAt) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Global AI Controls</CardTitle>
              <CardDescription>Applies platform-wide unless overridden at product or tenant scope</CardDescription>
            </div>
          </CardHeader>

          <div className="space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">Default Model</label>
              <Select
                value={defaultModel}
                onValueChange={setDefaultModel}
                options={AI_MODELS.map((m) => ({ value: m, label: m }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">
                  Daily Budget (USD)
                </label>
                <Input value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} type="number" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">
                  Monthly Budget (USD)
                </label>
                <Input value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} type="number" />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">
                Rate Limit (requests/min)
              </label>
              <Input value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} type="number" className="max-w-xs" />
            </div>

            <Toggle
              checked={cachingEnabled}
              onCheckedChange={setCachingEnabled}
              label="Response Caching"
              description="Cache identical prompts to reduce cost and latency"
            />

            {saveError && <p className="text-xs text-[var(--status-hot)]">{saveError}</p>}
            <div className="flex items-center justify-end gap-3">
              {saved && <span className="text-xs text-[var(--status-cold)]">Saved.</span>}
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </Card>

        <Card className="border-[color-mix(in_oklab,var(--status-hot)_30%,transparent)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-[var(--status-hot)]">
              <AlertTriangle className="h-4 w-4" /> Emergency Kill Switch
            </CardTitle>
            <CardDescription>Immediately halts all AI requests platform-wide</CardDescription>
          </CardHeader>
          <Button
            variant={killSwitch ? "secondary" : "destructive"}
            className="w-full"
            onClick={handleKillSwitchToggle}
            disabled={isTogglingKillSwitch}
          >
            <Power className="h-4 w-4" />
            {isTogglingKillSwitch ? "Updating..." : killSwitch ? "Kill Switch Active — Restore" : "Activate Kill Switch"}
          </Button>
          {killSwitch && (
            <p className="mt-3 text-xs text-[var(--status-hot)]">
              All AI requests are currently blocked across every product and tenant.
            </p>
          )}
        </Card>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--text-1)]">Product-Level Budgets</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {productBudgets.map((b) => (
            <Card key={b.id}>
              <CardHeader>
                <CardTitle>Product Budget</CardTitle>
                <CardDescription>Default model: {b.defaultModel}</CardDescription>
              </CardHeader>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-[var(--text-4)]">Daily Budget</div>
                  <div className="font-medium text-[var(--text-1)]">{formatCents(b.dailyBudgetCents)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--text-4)]">Monthly Budget</div>
                  <div className="font-medium text-[var(--text-1)]">{formatCents(b.monthlyBudgetCents)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--text-4)]">Rate Limit</div>
                  <div className="font-medium text-[var(--text-1)]">{b.rateLimitPerMin}/min</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--text-4)]">Kill Switch</div>
                  <Badge variant={b.killSwitchEnabled ? "hot" : "success"}>
                    {b.killSwitchEnabled ? "Active" : "Off"}
                  </Badge>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--text-1)]">Recent AI Usage</h2>
        <DataTable columns={logColumns} data={logs} rowKey={(l) => l.id} />
      </div>
    </div>
  );
}
