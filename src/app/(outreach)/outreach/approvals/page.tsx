import { getTenantSession } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { sendFailureIsPermanent } from "@/lib/outreach/email-failure-reasons";
import { ApprovalQueueClient } from "./ApprovalQueueClient";

export default async function OutreachApprovalsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  // Same widened scope as getApprovalQueueAction (see that function's own
  // comment): a failed-but-already-approved message shows here too, as a
  // distinct retry-only card, not reverted to "awaiting". "held" is
  // included too (fixed 2026-09-16) -- previously excluded here entirely,
  // which left held messages with no dashboard surface at all.
  const messages = await withTenant(tenantId, (tx) =>
    tx.outreachMessage.findMany({
      where: {
        tenantId,
        OR: [
          { approvalStatus: "awaiting" },
          { approvalStatus: "approved", sendStatus: "failed" },
          { approvalStatus: "held" },
        ],
      },
      include: {
        lead: { select: { id: true, businessName: true, platform: true, score: true, temperature: true, createdAt: true } },
      },
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
    sendFailureReason: m.sendFailureReason,
    // See email-failure-reasons.ts / outreach-approvals.ts's
    // serializeApprovalMessage for why this isn't simply "reason is set" --
    // most email failures are transient and should keep offering retry.
    sendFailurePermanent: sendFailureIsPermanent(m.channel, m.sendStatus, m.sendFailureReason),
    holdReason: m.holdReason,
    isFollowup: m.isFollowup,
    lead: {
      id: m.lead.id,
      businessName: m.lead.businessName,
      platform: m.lead.platform,
      score: m.lead.score,
      temperature: m.lead.temperature,
      // See outreach-approvals.ts's serializeApprovalMessage for why this
      // is the LEAD's own createdAt (discovery time), not the message's.
      discoveredAt: m.lead.createdAt.toISOString(),
    },
  }));

  return <ApprovalQueueClient tenantId={tenantId} initialMessages={serialized} />;
}
