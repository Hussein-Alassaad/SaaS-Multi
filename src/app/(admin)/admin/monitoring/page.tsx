import { getMonitoringOverview } from "@/lib/mock/monitoring";
import { KpiCard } from "@/components/ui/KpiCard";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { SystemFlowDiagram } from "@/components/diagram/SystemFlowDiagram";
import { Activity, Timer, AlertOctagon, Server } from "lucide-react";
import { agentControlAction } from "@/lib/actions/agent-control";
import { AgentControlCard } from "./AgentControlCard";

export default async function MonitoringPage() {
  const { errorRate, avgLatency, services, queues } = await getMonitoringOverview();
  const agentStatusResult = await agentControlAction("status");
  const agentStatus = agentStatusResult.ok ? agentStatusResult.status : "unknown";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Monitoring</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          System health, background queues, and a live map of how data flows through the platform.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="System Health" value="99.97%" icon={<Activity className="h-3.5 w-3.5" />} highlight />
        <KpiCard label="Avg AI Latency" value={`${avgLatency}ms`} icon={<Timer className="h-3.5 w-3.5" />} />
        <KpiCard label="Error Rate" value={`${errorRate.toFixed(2)}%`} icon={<AlertOctagon className="h-3.5 w-3.5" />} />
        <KpiCard label="Services Monitored" value={services.length.toString()} icon={<Server className="h-3.5 w-3.5" />} />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--text-1)]">System Data Flow</h2>
        <SystemFlowDiagram />
      </div>

      <AgentControlCard initialStatus={agentStatus} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Service Status</CardTitle>
            <CardDescription>Real-time health of core platform services</CardDescription>
          </CardHeader>
          <div className="space-y-2">
            {services.map((s) => (
              <div key={s.name} className="flex items-center justify-between border-b border-[var(--border-hairline)] py-2 last:border-0">
                <span className="text-sm text-[var(--text-2)]">{s.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--text-5)]">{s.latencyMs}ms</span>
                  <Badge variant={s.status === "operational" ? "success" : "warm"}>{s.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job Queues</CardTitle>
            <CardDescription>Background workers and current queue depth</CardDescription>
          </CardHeader>
          <div className="space-y-2">
            {queues.map((q) => (
              <div key={q.name} className="flex items-center justify-between border-b border-[var(--border-hairline)] py-2 last:border-0">
                <span className="font-mono text-xs text-[var(--text-2)]">{q.name}</span>
                <div className="flex items-center gap-3 text-xs text-[var(--text-4)]">
                  <span>{q.workers} workers</span>
                  <Badge variant={q.depth > 8 ? "warm" : "outline"}>{q.depth} queued</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
