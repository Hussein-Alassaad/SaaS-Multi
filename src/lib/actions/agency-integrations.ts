"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { encryptSecret } from "@/lib/crypto";
import { fetchWhatsAppNumberInfo } from "@/lib/channels/whatsapp";
import { fetchMetaAccountInfo } from "@/lib/channels/meta-messaging";
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

/**
 * Connects a REAL WhatsApp Business number (Meta Cloud API). The pair is
 * checked against Meta first, so a typo'd id or an expired token is rejected
 * here instead of silently never receiving anything. The token is stored
 * encrypted (APP_ENCRYPTION_KEY) and never sent back to the browser.
 */
export async function connectWhatsAppAction(input: { phoneNumberId: string; accessToken: string }) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "integrations", "edit");
  if (!permCheck.ok) return permCheck;

  const phoneNumberId = input.phoneNumberId.trim();
  const accessToken = input.accessToken.trim();
  if (!/^\d{5,25}$/.test(phoneNumberId)) return { ok: false as const, error: "Phone number ID should be digits only (copy it from the Meta WhatsApp API Setup page)." };
  if (accessToken.length < 20) return { ok: false as const, error: "Paste the full access token." };
  if (!process.env.APP_ENCRYPTION_KEY) return { ok: false as const, error: "The server is missing APP_ENCRYPTION_KEY, so the token cannot be stored safely." };
  if (!process.env.META_APP_SECRET || !process.env.WHATSAPP_VERIFY_TOKEN) {
    return { ok: false as const, error: "The server is missing META_APP_SECRET or WHATSAPP_VERIFY_TOKEN, so incoming messages could not be verified." };
  }

  const tenantId = session.tenantId!;
  const checked = await fetchWhatsAppNumberInfo(phoneNumberId, accessToken);
  if (!checked.ok) return { ok: false as const, error: `Meta rejected these details: ${checked.error}` };

  const displayName = [checked.info.verifiedName, checked.info.displayPhoneNumber].filter(Boolean).join(" · ") || phoneNumberId;
  const data = {
    status: "CONNECTED",
    connectedAt: new Date(),
    externalId: phoneNumberId,
    apiToken: encryptSecret(accessToken),
    displayName,
  };
  try {
    await withTenant(tenantId, (tx) =>
      tx.channel.upsert({
        where: { tenantId_provider: { tenantId, provider: "WHATSAPP" } },
        update: data,
        create: { tenantId, provider: "WHATSAPP", ...data },
      })
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false as const, error: "This WhatsApp number is already connected to another account." };
    }
    throw err;
  }

  revalidatePath("/agency/integrations");
  revalidatePath("/agency/ai-control");
  return { ok: true as const, displayName };
}

/** Disconnecting a real WhatsApp channel also wipes the stored token, same reasoning as disconnectOAuthChannelAction. */
export async function disconnectWhatsAppAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "integrations", "edit");
  if (!permCheck.ok) return permCheck;

  const tenantId = session.tenantId!;
  await withTenant(tenantId, (tx) =>
    tx.channel.updateMany({
      where: { tenantId, provider: "WHATSAPP" },
      data: { status: "DISCONNECTED", connectedAt: null, externalId: null, apiToken: null, displayName: null },
    })
  );

  revalidatePath("/agency/integrations");
  revalidatePath("/agency/ai-control");
  return { ok: true as const };
}

/**
 * Connects a real Facebook Page or Instagram business account for the AI
 * inbox. Same shape as connectWhatsAppAction: the id + token pair is checked
 * against Meta first, and the token is stored encrypted and never returned.
 */
export async function connectMetaChannelAction(input: { provider: "INSTAGRAM" | "FACEBOOK"; accountId: string; accessToken: string }) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "integrations", "edit");
  if (!permCheck.ok) return permCheck;

  if (input.provider !== "INSTAGRAM" && input.provider !== "FACEBOOK") return { ok: false as const, error: "Unknown channel." };
  const accountId = input.accountId.trim();
  const accessToken = input.accessToken.trim();
  const what = input.provider === "FACEBOOK" ? "Page ID" : "Instagram account ID";
  if (!/^\d{5,25}$/.test(accountId)) return { ok: false as const, error: `${what} should be digits only.` };
  if (accessToken.length < 20) return { ok: false as const, error: "Paste the full access token." };
  if (!process.env.APP_ENCRYPTION_KEY) return { ok: false as const, error: "The server is missing APP_ENCRYPTION_KEY, so the token cannot be stored safely." };
  if (!process.env.META_APP_SECRET || !process.env.WHATSAPP_VERIFY_TOKEN) {
    return { ok: false as const, error: "The server is missing META_APP_SECRET or WHATSAPP_VERIFY_TOKEN, so incoming messages could not be verified." };
  }

  const tenantId = session.tenantId!;
  const checked = await fetchMetaAccountInfo(input.provider, accountId, accessToken);
  if (!checked.ok) return { ok: false as const, error: `Meta rejected these details: ${checked.error}` };

  const data = {
    status: "CONNECTED",
    connectedAt: new Date(),
    externalId: accountId,
    apiToken: encryptSecret(accessToken),
    displayName: checked.displayName,
  };
  try {
    await withTenant(tenantId, (tx) =>
      tx.channel.upsert({
        where: { tenantId_provider: { tenantId, provider: input.provider } },
        update: data,
        create: { tenantId, provider: input.provider, ...data },
      })
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false as const, error: "This account is already connected to another workspace." };
    }
    throw err;
  }

  revalidatePath("/agency/integrations");
  revalidatePath("/agency/ai-control");
  return { ok: true as const, displayName: checked.displayName };
}

export async function disconnectMetaChannelAction(provider: "INSTAGRAM" | "FACEBOOK") {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "integrations", "edit");
  if (!permCheck.ok) return permCheck;
  if (provider !== "INSTAGRAM" && provider !== "FACEBOOK") return { ok: false as const, error: "Unknown channel." };

  const tenantId = session.tenantId!;
  await withTenant(tenantId, (tx) =>
    tx.channel.updateMany({
      where: { tenantId, provider },
      data: { status: "DISCONNECTED", connectedAt: null, externalId: null, apiToken: null, displayName: null },
    })
  );

  revalidatePath("/agency/integrations");
  revalidatePath("/agency/ai-control");
  return { ok: true as const };
}
