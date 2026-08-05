import { getAuditLogs } from "@/lib/mock/audit";
import { AuditLogsClient } from "./AuditLogsClient";

export default async function AuditLogsPage() {
  const logs = await getAuditLogs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Audit Logs</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Searchable trail of every administrative action across the platform.
        </p>
      </div>

      <AuditLogsClient
        logs={logs.map((l) => ({
          id: l.id,
          action: l.action,
          actorName: l.actor?.name ?? "System",
          tenantName: l.tenant?.companyName ?? null,
          ip: l.ip,
          device: l.device,
          browser: l.browser,
          createdAt: l.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
