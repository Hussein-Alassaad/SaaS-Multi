import { Prisma } from "@prisma/client";
import { withTenant } from "@/lib/db";

function readMeetingSlots(tx: Prisma.TransactionClient, tenantId: string) {
  return tx.meetingSlot.findMany({
    where: { tenantId },
    include: { request: { include: { nexarisClient: true } } },
    orderBy: { startsAt: "asc" },
  });
}

function readMeetingRequests(tx: Prisma.TransactionClient, tenantId: string) {
  return tx.meetingRequest.findMany({
    where: { tenantId },
    include: { slot: true, nexarisClient: true, conversation: { include: { channel: true } }, decidedBy: true },
    orderBy: { createdAt: "desc" },
  });
}

export function readPendingMeetingApprovals(tx: Prisma.TransactionClient, tenantId: string) {
  return tx.meetingRequest.findMany({
    where: { tenantId, status: "PENDING_APPROVAL" },
    include: { slot: true, nexarisClient: true, conversation: { include: { channel: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function getMeetingSlots(tenantId: string) {
  return withTenant(tenantId, (tx) => readMeetingSlots(tx, tenantId));
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
  return withTenant(tenantId, (tx) => readMeetingRequests(tx, tenantId));
}

export async function getPendingMeetingApprovals(tenantId: string) {
  return withTenant(tenantId, (tx) => readPendingMeetingApprovals(tx, tenantId));
}

/**
 * Meetings page's two reads in ONE tenant scope.
 *
 * Was Promise.all([getMeetingSlots, getMeetingRequests]) -- two concurrent
 * withTenant() calls, so two real Postgres transactions for one page load.
 * Same bug class as getPipelineBoard's 7 (see src/lib/outreach/leads.ts's
 * getPipelineBoard for the full writeup). The two readers above stay public
 * and single-scope for callers that genuinely need only one.
 */
export async function getMeetingsPageData(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const slots = await readMeetingSlots(tx, tenantId);
    const requests = await readMeetingRequests(tx, tenantId);
    return { slots, requests };
  });
}
