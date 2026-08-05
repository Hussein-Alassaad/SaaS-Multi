import { db } from "@/lib/db";

export async function getMonitoringOverview() {
  const [aiLogs, tenants] = await Promise.all([
    db.aiUsageLog.findMany({ orderBy: { createdAt: "desc" }, take: 500 }),
    db.tenant.count(),
  ]);

  const errorRate = aiLogs.length ? (aiLogs.filter((l) => !l.success).length / aiLogs.length) * 100 : 0;
  const avgLatency = aiLogs.length ? Math.round(aiLogs.reduce((s, l) => s + l.responseTimeMs, 0) / aiLogs.length) : 0;

  // Synthetic system components — representative of what a real ops page would show
  const services = [
    { name: "API Gateway", status: "operational", latencyMs: 42 },
    { name: "Postgres / SQLite Primary", status: "operational", latencyMs: 8 },
    { name: "AI Inference Router", status: errorRate > 8 ? "degraded" : "operational", latencyMs: avgLatency },
    { name: "Background Job Queue", status: "operational", latencyMs: 120 },
    { name: "Webhook Dispatcher", status: "operational", latencyMs: 65 },
    { name: "Object Storage", status: "operational", latencyMs: 30 },
  ];

  const queues = [
    { name: "email-delivery", depth: 3, workers: 2 },
    { name: "ai-inference", depth: 12, workers: 4 },
    { name: "webhook-dispatch", depth: 1, workers: 2 },
    { name: "billing-sync", depth: 0, workers: 1 },
  ];

  return { errorRate, avgLatency, tenants, services, queues };
}
