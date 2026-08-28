"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";
import type { ChannelProvider, OAuthChannelProvider } from "@/lib/agency/channels";

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

  await withTenant(tenantId, (tx) =>
    tx.channel.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      update: { status: connect ? "CONNECTED" : "DISCONNECTED", connectedAt: connect ? new Date() : null },
      create: {
        tenantId,
        provider,
        status: connect ? "CONNECTED" : "DISCONNECTED",
        connectedAt: connect ? new Date() : null,
      },
    })
  );

  revalidatePath("/agency/integrations");
  revalidatePath("/agency/ai-control");
  return { ok: true as const };
}

/**
 * Disconnects a real OAuth-connected email channel (GMAIL/OUTLOOK) --
 * distinct from toggleChannelConnectionAction above, which only flips a
 * status flag for the still-simulated WHATSAPP/INSTAGRAM/FACEBOOK channels.
 * This clears the stored tokens outright (not just the status), since a
 * "disconnected" Gmail/Outlook channel with a live refresh token still
 * sitting in the database would be a real, unnecessary secret left at
 * rest -- reconnecting later goes through the full OAuth consent flow
 * again (start/route.ts) rather than resuming from a kept-around token.
 *
 * Does NOT call Google's/Microsoft's own token-revocation endpoint (a real
 * gap, not an oversight -- flagged here rather than silently incomplete):
 * clearing our copy of the tokens stops THIS app from using them, but the
 * tenant's own Google/Microsoft account still shows this app as an
 * authorized connection until they revoke it from their own account
 * settings. Good enough for now; a follow-up could call each provider's
 * revoke endpoint here for a fully clean disconnect.
 */
export async function disconnectOAuthChannelAction(provider: OAuthChannelProvider) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "integrations", "edit");
  if (!permCheck.ok) return permCheck;

  const tenantId = session.tenantId!;

  await withTenant(tenantId, (tx) =>
    tx.channel.updateMany({
      where: { tenantId, provider },
      data: {
        status: "DISCONNECTED",
        connectedAt: null,
        oauthEmail: null,
        oauthAccessToken: null,
        oauthRefreshToken: null,
        oauthExpiresAt: null,
      },
    })
  );

  revalidatePath("/agency/integrations");
  revalidatePath("/agency/ai-control");
  return { ok: true as const };
}
