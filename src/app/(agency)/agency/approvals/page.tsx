import { getPendingApprovals } from "@/lib/agency/conversations";
import { getPendingMeetingApprovals } from "@/lib/agency/meetings";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { ApprovalsClient } from "./ApprovalsClient";

export default async function ApprovalsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const [pendingMessages, pendingMeetings] = await Promise.all([
    getPendingApprovals(tenantId),
    getPendingMeetingApprovals(tenantId),
  ]);

  const messages = pendingMessages.map((m) => ({
    id: m.id,
    body: m.body,
    language: m.language,
    createdAt: m.createdAt.toISOString(),
    client: {
      name: m.conversation.nexarisClient.name,
      phone: m.conversation.nexarisClient.phone,
    },
    channel: { provider: m.conversation.channel.provider },
  }));

  const meetings = pendingMeetings.map((r) => ({
    id: r.id,
    slotStartsAt: r.slot.startsAt.toISOString(),
    slotEndsAt: r.slot.endsAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    client: { name: r.nexarisClient.name, phone: r.nexarisClient.phone },
    channel: { provider: r.conversation.channel.provider },
  }));

  return <ApprovalsClient messages={messages} meetings={meetings} lang={lang} />;
}
