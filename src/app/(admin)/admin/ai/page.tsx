import { getAiOverview } from "@/lib/mock/ai";
import { KpiCard } from "@/components/ui/KpiCard";
import { AiControlClient } from "./AiControlClient";
import { formatCents } from "@/lib/utils";
import { DollarSign, Cpu, Timer, CheckCircle2 } from "lucide-react";

export default async function AiControlCenterPage() {
  const { logs, totalCost, totalTokens, avgLatency, successRate, globalBudget, productBudgets } =
    await getAiOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">AI Control Center</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Track usage and govern AI spend, models, and safety limits across the platform.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Total AI Cost (recent)" value={formatCents(totalCost)} icon={<DollarSign className="h-3.5 w-3.5" />} highlight />
        <KpiCard label="Total Tokens" value={totalTokens.toLocaleString()} icon={<Cpu className="h-3.5 w-3.5" />} />
        <KpiCard label="Avg Response Time" value={`${avgLatency}ms`} icon={<Timer className="h-3.5 w-3.5" />} />
        <KpiCard label="Success Rate" value={`${successRate.toFixed(1)}%`} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
      </div>

      <AiControlClient
        globalBudget={globalBudget ?? null}
        productBudgets={productBudgets}
        logs={logs}
      />
    </div>
  );
}
