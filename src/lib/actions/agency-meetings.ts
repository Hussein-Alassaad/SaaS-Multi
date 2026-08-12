"use server";

import { db } from "@/lib/db";
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

  await db.meetingSlot.create({
    data: { tenantId: session.tenantId!, startsAt: start, endsAt: end },
  });

  revalidatePath("/agency/meetings");
  return { ok: true as const };
}

export async function deleteMeetingSlotAction(slotId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "meetings", "delete");
  if (!permCheck.ok) return permCheck;

  const slot = await db.meetingSlot.findFirst({ where: { id: slotId, tenantId: session.tenantId! } });
  if (!slot) return { ok: false as const, error: "Slot not found." };
  if (slot.status === "BOOKED") return { ok: false as const, error: "Cannot delete a booked slot." };

  await db.meetingSlot.delete({ where: { id: slotId } });

  revalidatePath("/agency/meetings");
  return { ok: true as const };
}

export async function approveMeetingRequestAction(requestId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "approvals", "edit");
  if (!permCheck.ok) return permCheck;

  const request = await db.meetingRequest.findFirst({
    where: { id: requestId, tenantId: session.tenantId! },
    include: { conversation: true },
  });
  if (!request) return { ok: false as const, error: "Meeting request not found." };

  await db.$transaction([
    db.meetingRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", decidedById: session.id, decidedAt: new Date() },
    }),
    db.meetingSlot.update({ where: { id: request.slotId }, data: { status: "BOOKED" } }),
    db.conversation.update({ where: { id: request.conversationId }, data: { stage: "MEETING_BOOKED" } }),
  ]);

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

  const request = await db.meetingRequest.findFirst({ where: { id: requestId, tenantId: session.tenantId! } });
  if (!request) return { ok: false as const, error: "Meeting request not found." };

  await db.$transaction([
    db.meetingRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", decidedById: session.id, decidedAt: new Date() },
    }),
    db.meetingSlot.update({ where: { id: request.slotId }, data: { status: "AVAILABLE" } }),
  ]);

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/meetings");

  return { ok: true as const };
}
