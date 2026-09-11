import { getOutreachPerformanceByTenant } from "@/lib/outreach/admin-performance";
import { OutreachPerformanceClient } from "./OutreachPerformanceClient";

export default async function OutreachPerformancePage() {
  const rows = await getOutreachPerformanceByTenant();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Outreach Performance</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Reply rate, message rate, and deal rate across every Outreach client, so you can compare
          performance without opening each tenant's own Analytics page one at a time.
        </p>
      </div>

      <OutreachPerformanceClient rows={rows} />
    </div>
  );
}
