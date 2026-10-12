import { NextRequest, NextResponse, after } from "next/server";
import { withPlatformAccess } from "@/lib/db";
import { logError } from "@/lib/error-log";
import { createAlertIn } from "@/lib/agency/alerts";
import { processInboundMessage } from "@/lib/agency/inbound";
import {
  parseWhatsAppWebhook,
  verifyMetaSignature,
  type ParsedInboundMessage,
  type ParsedStatusUpdate,
} from "@/lib/channels/whatsapp";

/**
 * Meta's WhatsApp Cloud API webhook.
 *
 * GET  -- the one-time handshake when the webhook is saved in the Meta app
 *         dashboard: Meta sends hub.verify_token (must equal
 *         WHATSAPP_VERIFY_TOKEN) and expects hub.challenge echoed back.
 * POST -- every inbound customer message and every delivery-status update.
 *         Signed by Meta with META_APP_SECRET (X-Hub-Signature-256); anything
 *         unsigned or wrongly signed is rejected before the body is parsed,
 *         because this URL is public and an unverified payload would let
 *         anyone inject fake customer messages into a tenant's inbox.
 *
 * Meta wants a 200 within a few seconds or it retries, so the work (an AI
 * call that can take 10s+) runs in after(), once the response has gone out.
 * Retried deliveries are harmless: messages are deduped on their wamid.
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

  const { messages, statuses } = parseWhatsAppWebhook(payload);
  if (messages.length > 0 || statuses.length > 0) {
    after(async () => {
      for (const m of messages) {
        try {
          await handleInbound(m);
        } catch (err) {
          await logError({ source: "webhook.whatsapp_inbound", error: err, context: { messageId: m.messageId, phoneNumberId: m.phoneNumberId } });
        }
      }
      for (const s of statuses) {
        try {
          await handleStatus(s);
        } catch (err) {
          await logError({ source: "webhook.whatsapp_status", error: err, context: { messageId: s.messageId } });
        }
      }
    });
  }

  return NextResponse.json({ received: true });
}

async function findChannel(phoneNumberId: string) {
  return withPlatformAccess((tx) =>
    tx.channel.findUnique({
      where: { provider_externalId: { provider: "WHATSAPP", externalId: phoneNumberId } },
      select: { id: true, tenantId: true, status: true },
    })
  );
}

async function handleInbound(m: ParsedInboundMessage) {
  const channel = await findChannel(m.phoneNumberId);
  if (!channel) {
    await logError({ source: "webhook.whatsapp_unknown_number", error: new Error(`No channel for phone number id ${m.phoneNumberId}`), context: { phoneNumberId: m.phoneNumberId } });
    return;
  }
  await processInboundMessage({
    tenantId: channel.tenantId,
    channelId: channel.id,
    externalContactId: m.from,
    customerName: m.profileName,
    customerPhone: `+${m.from}`,
    body: m.text,
    externalMessageId: m.messageId,
  });
}

// A later stage never gets overwritten by an earlier one: Meta can deliver "sent" after "delivered".
const STATUS_RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };

async function handleStatus(s: ParsedStatusUpdate) {
  const next = s.status.toUpperCase();
  await withPlatformAccess(async (tx) => {
    const message = await tx.message.findUnique({
      where: { externalId: s.messageId },
      select: { id: true, deliveryStatus: true, conversation: { select: { id: true, tenantId: true, nexarisClient: { select: { name: true, phone: true } } } } },
    });
    if (!message) return;

    const current = message.deliveryStatus ? STATUS_RANK[message.deliveryStatus] ?? 0 : 0;
    if (next !== "FAILED" && STATUS_RANK[next] <= current) return;
    if (message.deliveryStatus === "FAILED" && next !== "FAILED") return;

    await tx.message.update({
      where: { id: message.id },
      data: { deliveryStatus: next, failureReason: next === "FAILED" ? (s.errorMessage ?? "WhatsApp reported the message failed.").slice(0, 500) : null },
    });
    if (next === "FAILED") {
      const c = message.conversation;
      await createAlertIn(tx, {
        tenantId: c.tenantId,
        type: "SEND_FAILED",
        title: "A reply was not delivered",
        body: `To ${c.nexarisClient.name ?? c.nexarisClient.phone ?? "a customer"}: ${s.errorMessage ?? "WhatsApp reported the message failed."}`,
        conversationId: c.id,
      });
    }
  });
}
