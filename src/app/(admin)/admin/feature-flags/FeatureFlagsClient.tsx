"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Toggle } from "@/components/ui/Toggle";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Plus } from "lucide-react";

interface FlagRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: string;
  scopeLabel: string;
  enabled: boolean;
}

const SCOPE_VARIANT: Record<string, "accent" | "cold" | "warm" | "outline"> = {
  GLOBAL: "accent",
  PRODUCT: "cold",
  TENANT: "warm",
  SUBSCRIPTION: "outline",
};

export function FeatureFlagsClient({ flags }: { flags: FlagRow[] }) {
  const [state, setState] = useState(Object.fromEntries(flags.map((f) => [f.id, f.enabled])));
  const [scopeFilter, setScopeFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const filtered = flags.filter((f) => {
    const matchesScope = scopeFilter === "ALL" || f.scope === scopeFilter;
    const matchesSearch =
      f.name.toLowerCase().includes(search.toLowerCase()) || f.key.toLowerCase().includes(search.toLowerCase());
    return matchesScope && matchesSearch;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input placeholder="Search flags..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Select
            value={scopeFilter}
            onValueChange={setScopeFilter}
            options={[
              { value: "ALL", label: "All scopes" },
              { value: "GLOBAL", label: "Global" },
              { value: "PRODUCT", label: "Product" },
              { value: "TENANT", label: "Tenant" },
              { value: "SUBSCRIPTION", label: "Subscription" },
            ]}
            className="w-44"
          />
        </div>
        <Button size="sm">
          <Plus className="h-3.5 w-3.5" />
          New Flag
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {filtered.map((f) => (
          <Card key={f.id} padding="md">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-[var(--text-1)]">{f.name}</span>
                  <Badge variant={SCOPE_VARIANT[f.scope] ?? "outline"}>{f.scope}</Badge>
                </div>
                <p className="mt-0.5 text-xs text-[var(--text-5)] font-mono">{f.key}</p>
                <p className="mt-1 text-xs text-[var(--text-4)]">{f.scopeLabel}</p>
                {f.description && <p className="mt-1 text-xs text-[var(--text-4)]">{f.description}</p>}
              </div>
              <Toggle checked={state[f.id]} onCheckedChange={(v) => setState((s) => ({ ...s, [f.id]: v }))} />
            </div>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-[var(--text-4)]">No flags match your filters.</p>
        )}
      </div>
    </div>
  );
}
