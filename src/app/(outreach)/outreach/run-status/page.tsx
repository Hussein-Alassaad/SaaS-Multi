import { getTenantSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { RunStatusClient } from "./RunStatusClient";

export default async function OutreachRunStatusPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const runs = await db.outreachRun.findMany({
    where: { tenantId },
    include: { account: { select: { label: true } } },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  const serialized = runs.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountLabel: r.account?.label ?? "Unknown account",
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    status: r.status,
    notes: r.notes,
  }));

  return <RunStatusClient tenantId={tenantId} initialRuns={serialized} />;
}
