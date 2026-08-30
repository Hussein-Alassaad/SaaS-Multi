import { getMeetingsPageData } from "@/lib/agency/meetings";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { MeetingsClient } from "./MeetingsClient";

export default async function MeetingsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  // One withTenant() scope for both reads -- see getMeetingsPageData.
  const { slots, requests } = await getMeetingsPageData(tenantId);

  const serializedSlots = slots.map((s) => ({
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    status: s.status,
    clientName: s.request?.nexarisClient.name ?? null,
  }));

  const serializedRequests = requests.map((r) => ({
    id: r.id,
    status: r.status,
    slotStartsAt: r.slot.startsAt.toISOString(),
    clientName: r.nexarisClient.name,
    clientPhone: r.nexarisClient.phone,
    channelProvider: r.conversation.channel.provider,
    createdAt: r.createdAt.toISOString(),
  }));

  return <MeetingsClient slots={serializedSlots} requests={serializedRequests} lang={lang} />;
}
