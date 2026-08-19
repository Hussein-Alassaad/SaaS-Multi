import { getTenantSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApprovalQueueClient } from "./ApprovalQueueClient";

export default async function OutreachApprovalsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const messages = await db.outreachMessage.findMany({
    where: { tenantId, approvalStatus: "awaiting" },
    include: { lead: { select: { id: true, businessName: true, platform: true, score: true, temperature: true } } },
    orderBy: { createdAt: "asc" },
  });

  const serialized = messages.map((m) => ({
    id: m.id,
    leadId: m.leadId,
    channel: m.channel,
    body: m.body,
    editedBody: m.editedBody,
    approvalStatus: m.approvalStatus,
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
