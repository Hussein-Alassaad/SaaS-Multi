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
  //
  // OWNER REQUEST 2026-10-06: also fetch every OTHER approved message
  // (pending/queued_for_pacing/sending/sent), not just the failed-retry
  // case -- the page now renders two real sections (Awaiting approval /
  // Approved) instead of only ever showing things that still need a
  // decision. ApprovalQueueClient itself splits these back apart by
  // approvalStatus/sendStatus; this query just needs to not leave any of
  // them out.
  const messages = await withTenant(tenantId, (tx) =>
    tx.outreachMessage.findMany({
      where: {
        tenantId,
        OR: [
          { approvalStatus: "awaiting" },
          { approvalStatus: "held" },
          { approvalStatus: "approved" },
        ],
      },
      include: {
        lead: { select: { id: true, businessName: true, platform: true, score: true, temperature: true, createdAt: true } },
      },
      orderBy: { createdAt: "asc" },
    })
  );

  // OWNER REQUEST 2026-10-06: surface the existing OutreachSettings.
  // approvalRequired toggle directly on this page too (it already lives in
  // Settings -- see SettingsClient.tsx's identical checkbox) so turning
  // auto-approve on/off doesn't require leaving the queue. off = every
  // newly generated message auto-approves itself (see
  // run_message_generation_cycle's own approval_required check on the
  // Python side) instead of landing in "Awaiting approval" first.
  const settings = await withTenant(tenantId, (tx) => tx.outreachSettings.findFirst({ where: { tenantId } }));
  const approvalRequired = settings?.approvalRequired ?? true;

  // OWNER REQUEST 2026-10-04: daily per-channel targets so each date
  // section in the queue can show "7 of 10 found" (Instagram) / "12 of 20
  // found" (email, all sourced from LinkedIn discovery -- see
  // ApprovalQueueClient's own comment on why email is the only real
  // outbound channel for LinkedIn-discovered leads). Summed across every
  // account of that platform this tenant has, since the real daily ceiling
  // is per-account (ig_daily_limit/linkedin_daily_limit), not a single
  // tenant-wide constant -- a tenant with 2 Instagram accounts has a real
  // target of 20, not 10. Email's target rides on linkedin_daily_limit
  // (not a separate email_daily_limit) because every email in this queue
  // originates from a LinkedIn-discovered company passing Icypeas lookup,
  // not from a distinct "email account" with its own send volume.
  const accounts = await withTenant(tenantId, (tx) =>
    tx.outreachAccount.findMany({
      where: { tenantId },
      select: { platform: true, igDailyLimit: true, linkedinDailyLimit: true },
    })
  );
  const dailyTargets = {
    instagram: accounts.filter((a) => a.platform === "instagram").reduce((sum, a) => sum + a.igDailyLimit, 0),
    email: accounts.filter((a) => a.platform === "linkedin").reduce((sum, a) => sum + a.linkedinDailyLimit, 0),
  };

  // OWNER REQUEST 2026-10-04: the "X of TARGET found" count must reflect
  // the FULL day's real output, not just what's still sitting in the queue
  // above -- once a message is approved and successfully sent it drops out
  // of that query entirely, which would make a fully-cleared day's count
  // shrink toward 0 instead of staying at the real total. Separate,
  // lightweight query (channel + date + approval/send status only, no
  // message bodies) across every message regardless of status, for exactly
  // the daily progress line -- NOT used for which cards render below.
  const allMessagesForCounts = await withTenant(tenantId, (tx) =>
    tx.outreachMessage.findMany({
      where: { tenantId },
      select: {
        channel: true,
        approvalStatus: true,
        sendStatus: true,
        lead: { select: { createdAt: true } },
      },
    })
  );
  const dailyCounts = allMessagesForCounts.reduce<Record<string, { igFound: number; igApproved: number; emailFound: number; emailApproved: number }>>(
    (acc, m) => {
      const d = m.lead.createdAt;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      acc[key] ??= { igFound: 0, igApproved: 0, emailFound: 0, emailApproved: 0 };
      // "Approved" here means cleared the approval step at all (approved OR
      // held OR actually sent) -- the same "not still awaiting a decision"
      // meaning the client's own per-section counter already uses.
      const decided = m.approvalStatus === "approved" || m.approvalStatus === "held";
      if (m.channel === "instagram") {
        acc[key].igFound += 1;
        if (decided) acc[key].igApproved += 1;
      } else if (m.channel === "email") {
        acc[key].emailFound += 1;
        if (decided) acc[key].emailApproved += 1;
      }
      return acc;
    },
    {}
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

  return (
    <ApprovalQueueClient
      tenantId={tenantId}
      initialMessages={serialized}
      dailyTargets={dailyTargets}
      dailyCounts={dailyCounts}
      initialApprovalRequired={approvalRequired}
    />
  );
}
