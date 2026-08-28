import { withTenant } from "@/lib/db";

export async function getMeetingSlots(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.meetingSlot.findMany({
      where: { tenantId },
      include: { request: { include: { nexarisClient: true } } },
      orderBy: { startsAt: "asc" },
    })
  );
}

export async function getAvailableSlots(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.meetingSlot.findMany({
      where: { tenantId, status: "AVAILABLE", startsAt: { gte: new Date() } },
      orderBy: { startsAt: "asc" },
    })
  );
}

export async function getMeetingRequests(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.meetingRequest.findMany({
      where: { tenantId },
      include: { slot: true, nexarisClient: true, conversation: { include: { channel: true } }, decidedBy: true },
      orderBy: { createdAt: "desc" },
    })
  );
}

export async function getPendingMeetingApprovals(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.meetingRequest.findMany({
      where: { tenantId, status: "PENDING_APPROVAL" },
      include: { slot: true, nexarisClient: true, conversation: { include: { channel: true } } },
      orderBy: { createdAt: "asc" },
    })
  );
}
