"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";
import type { ChannelProvider } from "@/lib/agency/channels";

/**
 * Simulated connect/disconnect -- flips Channel.status, no real OAuth or
 * webhook registration. See plan notes: real WhatsApp/Instagram/Facebook
 * API wiring is deferred until Meta Business verification is in hand.
 */
export async function toggleChannelConnectionAction(provider: ChannelProvider, connect: boolean) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "integrations", "edit");
  if (!permCheck.ok) return permCheck;

  const tenantId = session.tenantId!;

  await db.channel.upsert({
    where: { tenantId_provider: { tenantId, provider } },
    update: { status: connect ? "CONNECTED" : "DISCONNECTED", connectedAt: connect ? new Date() : null },
    create: {
      tenantId,
      provider,
      status: connect ? "CONNECTED" : "DISCONNECTED",
      connectedAt: connect ? new Date() : null,
    },
  });

  revalidatePath("/agency/integrations");
  revalidatePath("/agency/ai-control");
  return { ok: true as const };
}
