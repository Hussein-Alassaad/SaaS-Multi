import { getTenantSession } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { ApprovalQueueClient } from "./ApprovalQueueClient";

export default async function OutreachApprovalsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  // Same widened scope as getApprovalQueueAction (see that function's own
  // comment): a failed-but-already-approved message shows here too, as a
  // distinct retry-only card, not reverted to "awaiting".
  const messages = await withTenant(tenantId, (tx) =>
    tx.outreachMessage.findMany({
      where: {
        tenantId,
        OR: [
          { approvalStatus: "awaiting" },
          { approvalStatus: "approved", sendStatus: "failed" },
        ],
      },
      include: { lead: { select: { id: true, businessName: true, platform: true, score: true, temperature: true } } },
      orderBy: { createdAt: "asc" },
    })
  );

  const serialized = messages.map((m) => ({
    id: m.id,
    leadId: m.leadId,
    channel: m.channel,
    body: m.body,
    editedBody: m.editedBody,
    approvalStatus: m.approvalStatus,
    sendStatus: m.sendStatus,
    lead: {
      id: m.lead.id,
      businessName: m.lead.businessName,
      platform: m.lead.platform,
      score: m.lead.score,
      temperature: m.lead.temperature,
    },
  }));

  return <ApprovalQueueClient tenantId={tenantId} initialMessages={serialized} />;
}
