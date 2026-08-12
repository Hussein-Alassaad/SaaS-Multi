import { getPipelineBoard } from "@/lib/agency/conversations";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { PipelineClient } from "./PipelineClient";

export default async function PipelinePage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const conversations = await getPipelineBoard(tenantId);

  const serialized = conversations.map((c) => ({
    id: c.id,
    stage: c.stage,
    channel: { provider: c.channel.provider },
    client: { name: c.nexarisClient.name, phone: c.nexarisClient.phone, tag: c.nexarisClient.tag },
    lastMessage: c.messages[0]?.body ?? null,
    lastMessageAt: c.lastMessageAt.toISOString(),
  }));

  return <PipelineClient conversations={serialized} lang={lang} />;
}
