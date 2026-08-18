import { getErrorLogs } from "@/lib/mock/error-logs";
import { ErrorLogsClient } from "./ErrorLogsClient";

export default async function ErrorLogsPage() {
  const logs = await getErrorLogs();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Error Logs</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Failures that would otherwise only exist in server console output -- AI reply generation, email
          delivery, payment review, and other background operations.
        </p>
      </div>

      <ErrorLogsClient
        logs={logs.map((l) => ({
          id: l.id,
          source: l.source,
          message: l.message,
          tenantName: l.tenant?.companyName ?? null,
          resolved: l.resolved,
          context: l.context,
          createdAt: l.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
