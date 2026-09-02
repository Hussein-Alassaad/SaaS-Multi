import { getTenantSession } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { RunStatusClient } from "./RunStatusClient";

export default async function OutreachRunStatusPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const runs = await withTenant(tenantId, (tx) =>
    tx.outreachRun.findMany({
      where: { tenantId },
      include: { account: { select: { label: true } } },
      orderBy: { startedAt: "desc" },
      take: 20,
    })
  );

  const STAGE_LABELS: Record<string, string> = {
    analysis: "Analysis",
    message_generation: "Message generation",
    sending: "Sending",
  };

  const serialized = runs.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    // Discovery rows are per-account, so the account's own label ("Zimmar
    // LinkedIn") is the real, meaningful name. The other three stages are
    // tenant-wide (see OutreachRun.stage's schema comment) -- no single
    // account to name, so a real stage label stands in instead of the
    // misleading "Unknown account" this used to show for those rows.
    accountLabel: r.account?.label ?? STAGE_LABELS[r.stage] ?? "Unknown account",
    stage: r.stage,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    status: r.status,
    notes: r.notes,
  }));

  return <RunStatusClient tenantId={tenantId} initialRuns={serialized} />;
}
