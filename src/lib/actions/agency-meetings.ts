"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";

export async function createMeetingSlotAction(startsAt: string, durationMin: number) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "meetings", "create");
  if (!permCheck.ok) return permCheck;

  const start = new Date(startsAt);
  if (isNaN(start.getTime())) return { ok: false as const, error: "Invalid date/time." };
  const end = new Date(start.getTime() + durationMin * 60000);

  await withTenant(session.tenantId!, (tx) =>
    tx.meetingSlot.create({
      data: { tenantId: session.tenantId!, startsAt: start, endsAt: end },
    })
  );

  revalidatePath("/agency/meetings");
  return { ok: true as const };
}

export async function deleteMeetingSlotAction(slotId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "meetings", "delete");
  if (!permCheck.ok) return permCheck;

  const result = await withTenant(session.tenantId!, async (tx) => {
    const slot = await tx.meetingSlot.findFirst({ where: { id: slotId, tenantId: session.tenantId! } });
    if (!slot) return "not_found" as const;
    if (slot.status === "BOOKED") return "booked" as const;
    await tx.meetingSlot.delete({ where: { id: slotId } });
    return "deleted" as const;
  });
  if (result === "not_found") return { ok: false as const, error: "Slot not found." };
  if (result === "booked") return { ok: false as const, error: "Cannot delete a booked slot." };

  revalidatePath("/agency/meetings");
  return { ok: true as const };
}

export async function approveMeetingRequestAction(requestId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const request = await tx.meetingRequest.findFirst({
      where: { id: requestId, tenantId: session.tenantId! },
      include: { conversation: true },
    });
    if (!request) return false;

    // Was a db.$transaction([...]) array before RLS -- sequential against the
    // same `tx` now, still one atomic transaction.
    await tx.meetingRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", decidedById: session.id, decidedAt: new Date() },
    });
    await tx.meetingSlot.update({ where: { id: request.slotId }, data: { status: "BOOKED" } });
    await tx.conversation.update({ where: { id: request.conversationId }, data: { stage: "MEETING_BOOKED" } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Meeting request not found." };

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/meetings");
  revalidatePath("/agency/pipeline");

  return { ok: true as const };
}

export async function rejectMeetingRequestAction(requestId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const request = await tx.meetingRequest.findFirst({ where: { id: requestId, tenantId: session.tenantId! } });
    if (!request) return false;

    // Was a db.$transaction([...]) array before RLS -- sequential against the
    // same `tx` now, still one atomic transaction.
    await tx.meetingRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", decidedById: session.id, decidedAt: new Date() },
    });
    await tx.meetingSlot.update({ where: { id: request.slotId }, data: { status: "AVAILABLE" } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Meeting request not found." };

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/meetings");

  return { ok: true as const };
}
