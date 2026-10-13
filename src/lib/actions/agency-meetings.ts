"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";
import { deliverMessage } from "@/lib/channels/dispatch";
import { formatSlotLabel, parseLocalInput, safeTimezone, type SlotLabelLanguage } from "@/lib/agency/slots";

async function getTenantTimezone(tenantId: string) {
  const row = await withTenant(tenantId, (tx) => tx.localizationSettings.findUnique({ where: { tenantId }, select: { timezone: true } }));
  return safeTimezone(row?.timezone);
}

function confirmationText(language: string, label: string): string {
  if (language.startsWith("AR")) return `تم تأكيد موعد المكالمة يوم ${label}. رح يتصل فيك فريقنا على هالرقم.`;
  if (language === "ARABIZI") return `Mawed el mkelme mta2akkad: ${label}. Ra7 yettasel fik fari2na 3a hal ra2em.`;
  return `Your call is confirmed for ${label}. Our team will phone you on this number.`;
}

export async function createMeetingSlotAction(startsAt: string, durationMin: number) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "meetings", "create");
  if (!permCheck.ok) return permCheck;

  // The form sends the owner's wall-clock time ("2026-10-14T15:00"); it means the business's timezone, not the server's.
  const tenantId = session.tenantId!;
  const tz = await getTenantTimezone(tenantId);
  const start = parseLocalInput(startsAt, tz) ?? new Date(startsAt);
  if (isNaN(start.getTime())) return { ok: false as const, error: "Invalid date/time." };
  const end = new Date(start.getTime() + durationMin * 60000);

  await withTenant(tenantId, (tx) =>
    tx.meetingSlot.create({
      data: { tenantId, startsAt: start, endsAt: end },
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
    return { conversationId: request.conversationId, language: request.conversation.language, slotId: request.slotId };
  });
  if (!found) return { ok: false as const, error: "Meeting request not found." };

  // Tell the customer it is confirmed, on the channel they wrote from. Failing to send never undoes the booking:
  // the message row records why, the admin gets a SEND_FAILED alert, and they can message the customer themselves.
  const tenantId = session.tenantId!;
  const slot = await withTenant(tenantId, (tx) => tx.meetingSlot.findUniqueOrThrow({ where: { id: found.slotId } }));
  const label = formatSlotLabel(slot.startsAt, await getTenantTimezone(tenantId), found.language as SlotLabelLanguage);
  const notice = await withTenant(tenantId, (tx) =>
    tx.message.create({
      data: {
        conversationId: found.conversationId,
        sender: "HUMAN",
        body: confirmationText(found.language, label),
        language: found.language,
        status: "APPROVED",
        approvedById: session.id,
        approvedAt: new Date(),
      },
    })
  );
  const delivery = await deliverMessage(tenantId, notice.id);

  revalidatePath("/agency/approvals");
  revalidatePath("/agency/meetings");
  revalidatePath("/agency/pipeline");
  revalidatePath("/agency/inbox");

  return { ok: true as const, customerNotified: delivery.ok && !("skipped" in delivery && delivery.skipped === "simulated") };
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

const TIME_RANGE_ERROR = "Hours must be between 0 and 24, with the end after the start.";

/** Saves the working hours the AI offers meetings in. Open slots are then generated from them automatically. */
export async function saveMeetingAvailabilityAction(input: {
  enabled: boolean;
  days: number[];
  startHour: number;
  endHour: number;
  durationMin: number;
  horizonDays: number;
}) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "meetings", "edit");
  if (!permCheck.ok) return permCheck;

  const days = [...new Set(input.days)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (input.enabled && days.length === 0) return { ok: false as const, error: "Pick at least one day." };
  if (!(Number.isInteger(input.startHour) && Number.isInteger(input.endHour)) || input.startHour < 0 || input.endHour > 24 || input.endHour <= input.startHour) {
    return { ok: false as const, error: TIME_RANGE_ERROR };
  }
  if (!Number.isInteger(input.durationMin) || input.durationMin < 15 || input.durationMin > 240) return { ok: false as const, error: "Meeting length must be 15 to 240 minutes." };
  if (!Number.isInteger(input.horizonDays) || input.horizonDays < 1 || input.horizonDays > 30) return { ok: false as const, error: "Offer times up to 1 to 30 days ahead." };

  const tenantId = session.tenantId!;
  const data = {
    meetingAutoSlots: input.enabled,
    meetingDays: days.join(","),
    meetingStartHour: input.startHour,
    meetingEndHour: input.endHour,
    meetingDurationMin: input.durationMin,
    meetingHorizonDays: input.horizonDays,
    // Forget what was already generated so the new hours apply from today (exact duplicates are skipped).
    meetingSlotsThrough: null,
  };
  await withTenant(tenantId, (tx) => tx.aiSettings.upsert({ where: { tenantId }, update: data, create: { tenantId, ...data } }));

  revalidatePath("/agency/meetings");
  return { ok: true as const };
}
