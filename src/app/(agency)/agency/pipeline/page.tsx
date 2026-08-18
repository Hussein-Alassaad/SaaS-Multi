import { getPipelineBoard, PIPELINE_STAGES } from "@/lib/agency/conversations";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { PipelineClient } from "./PipelineClient";

export default async function PipelinePage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const board = await getPipelineBoard(tenantId);

  const columns = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [
      stage,
      {
        cards: board[stage].items.map((c) => ({
          id: c.id,
          stage: c.stage,
          channel: { provider: c.channel.provider },
          client: { name: c.nexarisClient.name, phone: c.nexarisClient.phone, tag: c.nexarisClient.tag },
          lastMessage: c.messages[0]?.body ?? null,
          lastMessageAt: c.lastMessageAt.toISOString(),
        })),
        nextCursor: board[stage].nextCursor,
      },
    ])
  );

  return <PipelineClient columns={columns} lang={lang} />;
}
