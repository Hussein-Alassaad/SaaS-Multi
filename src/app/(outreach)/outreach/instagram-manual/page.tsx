import { getTenantSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { InstagramManualSendClient } from "./InstagramManualSendClient";

export default async function OutreachInstagramManualPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const messages = await db.outreachMessage.findMany({
    where: { tenantId, channel: "instagram", sendStatus: "manual_send_pending" },
    include: { lead: { select: { id: true, businessName: true, profileUrl: true } } },
    orderBy: { createdAt: "asc" },
  });

  const serialized = messages.map((m) => ({
    id: m.id,
    body: m.body,
    editedBody: m.editedBody,
    lead: { id: m.lead.id, businessName: m.lead.businessName, profileUrl: m.lead.profileUrl },
  }));

  return <InstagramManualSendClient tenantId={tenantId} initialMessages={serialized} />;
}
