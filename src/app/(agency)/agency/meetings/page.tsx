import { getMeetingsPageData } from "@/lib/agency/meetings";
import { withTenant } from "@/lib/db";
import { safeTimezone } from "@/lib/agency/slots";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { MeetingsClient } from "./MeetingsClient";

export default async function MeetingsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  // One withTenant() scope for both reads -- see getMeetingsPageData.
  const { slots, requests } = await getMeetingsPageData(tenantId);
  const { settings, timezone } = await withTenant(tenantId, async (tx) => ({
    settings: await tx.aiSettings.findUnique({ where: { tenantId } }),
    timezone: safeTimezone((await tx.localizationSettings.findUnique({ where: { tenantId }, select: { timezone: true } }))?.timezone),
  }));

  const serializedSlots = slots.map((s) => ({
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status,
    clientName: s.request?.nexarisClient.name ?? null,
  }));

  const serializedRequests = requests.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    status: r.status,
    slotStartsAt: r.slot.startsAt.toISOString(),
    clientName: r.nexarisClient.name,
    clientPhone: r.nexarisClient.phone,
    channelProvider: r.conversation.channel.provider,
    createdAt: r.createdAt.toISOString(),
  }));

  const availability = {
    enabled: settings?.meetingAutoSlots ?? false,
    days: (settings?.meetingDays ?? "1,2,3,4,5").split(",").map(Number),
    startHour: settings?.meetingStartHour ?? 10,
    endHour: settings?.meetingEndHour ?? 17,
    durationMin: settings?.meetingDurationMin ?? 30,
    horizonDays: settings?.meetingHorizonDays ?? 7,
  };

  return <MeetingsClient slots={serializedSlots} requests={serializedRequests} lang={lang} timezone={timezone} availability={availability} />;
}
