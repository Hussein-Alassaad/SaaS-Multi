import { getTenantSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { InstagramManualSendClient } from "./InstagramManualSendClient";

/**
 * Renamed in spirit (not in URL, to avoid a dead link in bookmarks/nav
 * history) from a manual-send action queue to a pure status view --
 * Instagram cold messages now auto-send via instagram_send.send_cold_message()
 * (see outreach/agent/scheduler.py's _run_sending_cycle_for_tenant()), so
 * there's no longer a "Mark as Sent" action for a human to take here. This
 * page now just shows where every Instagram lead sits: To Contact (approved,
 * not yet sent), Contacted (sent, no reply yet), Replied (has a reply --
 * links into "Reply Here" for the actual conversation/reply box).
 */
export default async function OutreachInstagramManualPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const [toContact, contacted, replied] = await Promise.all([
    db.outreachMessage.findMany({
      where: { tenantId, channel: "instagram", isReply: false, approvalStatus: "approved", sendStatus: "pending" },
      include: { lead: { select: { id: true, businessName: true, profileUrl: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.outreachLead.findMany({
      where: { tenantId, platform: "instagram", status: "contacted" },
      select: { id: true, businessName: true, profileUrl: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.outreachLead.findMany({
      where: { tenantId, platform: "instagram", status: { in: ["replied", "interested", "meeting_booked"] } },
      select: { id: true, businessName: true, profileUrl: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return (
    <InstagramManualSendClient
      toContact={toContact.map((m) => ({
        id: m.id,
        body: m.body,
        editedBody: m.editedBody,
        lead: { id: m.lead.id, businessName: m.lead.businessName, profileUrl: m.lead.profileUrl },
      }))}
      contacted={contacted.map((l) => ({ id: l.id, businessName: l.businessName, profileUrl: l.profileUrl }))}
      replied={replied.map((l) => ({ id: l.id, businessName: l.businessName, profileUrl: l.profileUrl }))}
      tenantId={tenantId}
    />
  );
}
