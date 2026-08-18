import { getConversationsList } from "@/lib/agency/conversations";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { InboxClient } from "./InboxClient";

export default async function InboxPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const { items, nextCursor } = await getConversationsList(tenantId);

  const serialized = items.map((c) => ({
    id: c.id,
    stage: c.stage,
    status: c.status,
    language: c.language,
    lastMessageAt: c.lastMessageAt.toISOString(),
    channel: { provider: c.channel.provider },
    client: {
      id: c.nexarisClient.id,
      name: c.nexarisClient.name,
      phone: c.nexarisClient.phone,
    },
    lastMessage: c.messages[0]
      ? { body: c.messages[0].body, sender: c.messages[0].sender, status: c.messages[0].status }
      : null,
  }));

  return <InboxClient conversations={serialized} initialNextCursor={nextCursor} lang={lang} />;
}
