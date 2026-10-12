import { NextRequest, NextResponse, after } from "next/server";
import { withPlatformAccess } from "@/lib/db";
import { logError } from "@/lib/error-log";
import { decryptSecret } from "@/lib/crypto";
import { processInboundMessage } from "@/lib/agency/inbound";
import { verifyMetaSignature } from "@/lib/channels/whatsapp";
import {
  parseMetaMessagingWebhook,
  fetchMetaContactName,
  type ParsedMetaMessage,
  type ParsedMetaStatus,
} from "@/lib/channels/meta-messaging";

/**
 * Meta's Messenger + Instagram webhook (same Meta app and app secret as the
 * WhatsApp one; WhatsApp has its own route because its payload differs).
 *
 * GET  -- the one-time handshake when the webhook is saved in the Meta app
 *         dashboard (hub.verify_token must equal WHATSAPP_VERIFY_TOKEN -- one
 *         verify token serves every Meta webhook of this platform).
 * POST -- customer messages and delivery/read receipts for Facebook Pages
 *         (object "page") and Instagram accounts (object "instagram"). Signed
 *         with META_APP_SECRET; unsigned or wrongly signed requests are
 *         rejected before the body is parsed.
 *
 * The response goes out immediately and the work (an AI call) runs in after();
 * a redelivered message is harmless because messages are deduped on their mid.
 */

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === expected) {
    return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse("Bad JSON", { status: 400 });
  }

  const { messages, statuses } = parseMetaMessagingWebhook(payload);
  if (messages.length > 0 || statuses.length > 0) {
    after(async () => {
      for (const m of messages) {
        try {
          await handleInbound(m);
        } catch (err) {
          await logError({ source: "webhook.meta_inbound", error: err, context: { messageId: m.messageId, provider: m.provider } });
        }
      }
      for (const s of statuses) {
        try {
          await handleStatus(s);
        } catch (err) {
          await logError({ source: "webhook.meta_status", error: err, context: { provider: s.provider } });
        }
      }
    });
  }

  return NextResponse.json({ received: true });
}

function findChannel(provider: string, accountId: string) {
  return withPlatformAccess((tx) =>
    tx.channel.findUnique({
      where: { provider_externalId: { provider, externalId: accountId } },
      select: { id: true, tenantId: true, apiToken: true },
    })
  );
}

async function handleInbound(m: ParsedMetaMessage) {
  const channel = await findChannel(m.provider, m.accountId);
  if (!channel) {
    await logError({
      source: "webhook.meta_unknown_account",
      error: new Error(`No ${m.provider} channel for account id ${m.accountId}`),
      context: { provider: m.provider, accountId: m.accountId },
    });
    return;
  }

  // Messenger / Instagram webhooks carry no name. Look it up once, when the chat starts, so the inbox shows a person
  // instead of an anonymous id. Failure just leaves the name empty; the AI asks for it.
  let customerName: string | null = null;
  const existing = await withPlatformAccess((tx) =>
    tx.conversation.findFirst({ where: { channelId: channel.id, externalContactId: m.from }, select: { id: true } })
  );
  if (!existing && channel.apiToken) {
    const token = decryptSecret(channel.apiToken);
    if (token) customerName = await fetchMetaContactName(m.provider, m.from, token);
  }

  await processInboundMessage({
    tenantId: channel.tenantId,
    channelId: channel.id,
    externalContactId: m.from,
    customerName,
    customerPhone: null,
    body: m.text,
    externalMessageId: m.messageId,
  });
}

async function handleStatus(s: ParsedMetaStatus) {
  const channel = await findChannel(s.provider, s.accountId);
  if (!channel) return;

  await withPlatformAccess(async (tx) => {
    if (s.kind === "delivered") {
      // Never moves a message backwards (a READ is not overwritten by a late DELIVERED).
      await tx.message.updateMany({
        where: { externalId: { in: s.mids }, deliveryStatus: { in: ["QUEUED", "SENT"] }, conversation: { channelId: channel.id } },
        data: { deliveryStatus: "DELIVERED" },
      });
      return;
    }
    // A read receipt is a watermark: everything we sent to this customer up to that time has been seen.
    await tx.message.updateMany({
      where: {
        sender: { in: ["AI", "HUMAN"] },
        deliveryStatus: { in: ["SENT", "DELIVERED"] },
        createdAt: { lte: s.watermark },
        conversation: { channelId: channel.id, externalContactId: s.contactId },
      },
      data: { deliveryStatus: "READ" },
    });
  });
}
