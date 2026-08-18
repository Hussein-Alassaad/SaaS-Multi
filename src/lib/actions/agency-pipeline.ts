"use server";

import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { getPipelineColumn, type PipelineStage } from "@/lib/agency/conversations";

/** "Load more" for a single Pipeline board column. */
export async function loadMorePipelineColumnAction(stage: PipelineStage, cursor: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "pipeline", "view");
  if (!permCheck.ok) return permCheck;

  const { items, nextCursor } = await getPipelineColumn(session.tenantId!, stage, cursor);

  return {
    ok: true as const,
    nextCursor,
    cards: items.map((c) => ({
      id: c.id,
      stage: c.stage,
      channel: { provider: c.channel.provider },
      client: { name: c.nexarisClient.name, phone: c.nexarisClient.phone, tag: c.nexarisClient.tag },
      lastMessage: c.messages[0]?.body ?? null,
      lastMessageAt: c.lastMessageAt.toISOString(),
    })),
  };
}
