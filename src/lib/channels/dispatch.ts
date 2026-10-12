/**
 * Sends an approved/auto-sent Message out over its real channel.
 *
 * Before this existed, "approving" a reply only flipped a status in our own
 * database -- nothing ever left the platform. deliverMessage() is the single
 * place a message goes to the customer, called from both the auto-send path
 * (inbound.ts) and the human approve / edit / reply actions.
 *
 * Safe to call twice for the same message: the claim step below moves
 * deliveryStatus from null/FAILED to QUEUED in one atomic UPDATE, so only one
 * caller ever sends it. Channels without real credentials (the simulated
 * ones used for demos) are skipped, not failed.
 */

import { withTenant } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { logError } from "@/lib/error-log";
import { createAlert } from "@/lib/agency/alerts";
import { isWithinCustomerServiceWindow, sendWhatsAppText } from "@/lib/channels/whatsapp";

export type DeliverResult =
  | { ok: true; skipped: "simulated" | "already_sent" | "not_sendable" }
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export async function deliverMessage(tenantId: string, messageId: string): Promise<DeliverResult> {
  const loaded = await withTenant(tenantId, async (tx) => {
    const message = await tx.message.findFirst({
      where: { id: messageId, conversation: { tenantId } },
      include: { conversation: { include: { channel: true, nexarisClient: true } } },
    });
    if (!message) return null;
    return message;
  });
  if (!loaded) return { ok: false, error: "Message not found." };

  const { conversation } = loaded;
  const channel = conversation.channel;

  // Only messages that are cleared to go: auto-sent AI replies (SENT), approved ones, and human replies (APPROVED).
  if (loaded.sender === "CUSTOMER" || (loaded.status !== "SENT" && loaded.status !== "APPROVED")) {
    return { ok: true, skipped: "not_sendable" };
  }

  const isReal = channel.provider === "WHATSAPP" && !!channel.externalId && !!channel.apiToken && !!conversation.externalContactId;
  if (!isReal) return { ok: true, skipped: "simulated" };

  // Atomic claim: whoever flips null/FAILED -> QUEUED first is the only one that sends.
  const claimed = await withTenant(tenantId, (tx) =>
    tx.message.updateMany({
      where: { id: messageId, OR: [{ deliveryStatus: null }, { deliveryStatus: "FAILED" }] },
      data: { deliveryStatus: "QUEUED", failureReason: null },
    })
  );
  if (claimed.count === 0) return { ok: true, skipped: "already_sent" };

  const fail = async (reason: string) => {
    await withTenant(tenantId, (tx) =>
      tx.message.update({ where: { id: messageId }, data: { deliveryStatus: "FAILED", failureReason: reason.slice(0, 500) } })
    );
    await createAlert({
      tenantId,
      type: "SEND_FAILED",
      title: "A reply could not be sent",
      body: `To ${conversation.nexarisClient.name ?? conversation.externalContactId}: ${reason}`,
      conversationId: conversation.id,
    }).catch(() => undefined);
    return { ok: false as const, error: reason };
  };

  // WhatsApp only allows a free-form message within 24h of the customer's last message.
  if (!isWithinCustomerServiceWindow(conversation.lastCustomerMessageAt)) {
    return fail("More than 24 hours since the customer's last message, so WhatsApp does not allow a free-form reply. Ask them to message you again.");
  }

  const token = decryptSecret(channel.apiToken!);
  if (!token) return fail("The saved WhatsApp access token could not be read. Reconnect WhatsApp in Integrations.");

  try {
    const sent = await sendWhatsAppText({
      phoneNumberId: channel.externalId!,
      token,
      to: conversation.externalContactId!,
      body: loaded.body,
    });
    if (!sent.ok) {
      await logError({ source: "channels.whatsapp_send", error: new Error(sent.error), tenantId, context: { messageId, code: sent.code } });
      return fail(sent.error);
    }
    await withTenant(tenantId, (tx) =>
      tx.message.update({ where: { id: messageId }, data: { externalId: sent.messageId, deliveryStatus: "SENT", failureReason: null } })
    );
    return { ok: true, messageId: sent.messageId };
  } catch (err) {
    await logError({ source: "channels.whatsapp_send", error: err, tenantId, context: { messageId } });
    return fail(err instanceof Error ? err.message : "Unexpected error while sending.");
  }
}
