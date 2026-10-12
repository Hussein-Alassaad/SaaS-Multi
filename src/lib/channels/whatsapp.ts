/**
 * WhatsApp Business Cloud API (Meta) -- webhook verification/parsing and
 * outbound text sending. Pure functions with no database access, so they can
 * be tested in isolation; src/lib/channels/dispatch.ts and
 * src/app/api/webhooks/whatsapp/route.ts do the wiring.
 *
 * ENV (set once for the whole platform -- one Meta app serves every tenant):
 *   META_APP_SECRET        the Meta app's secret; every webhook is signed with it
 *   WHATSAPP_VERIFY_TOKEN  any string you choose; Meta echoes it back when you register the webhook
 *   META_GRAPH_VERSION     optional, default v21.0
 *   WHATSAPP_API_BASE      optional override of the Graph API base URL (used by tests)
 * Per tenant (stored on the Channel row): phone_number_id + a long-lived access token.
 */

import { createHmac, timingSafeEqual } from "crypto";

export function graphBase(): string {
  return process.env.WHATSAPP_API_BASE || `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v21.0"}`;
}

/** WhatsApp lets you send free-form replies only within this long after the customer's last message. */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinCustomerServiceWindow(lastCustomerMessageAt: Date | null | undefined, now = new Date()): boolean {
  if (!lastCustomerMessageAt) return false;
  return now.getTime() - lastCustomerMessageAt.getTime() < CUSTOMER_SERVICE_WINDOW_MS;
}

/**
 * Meta signs the RAW request body with the app secret: header
 * `X-Hub-Signature-256: sha256=<hex hmac>`. Must be checked before anything in
 * the body is trusted -- the endpoint is public by necessity, so an unchecked
 * payload would let anyone inject a fake customer message. Fails closed: no
 * secret configured means every request is rejected.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret = process.env.META_APP_SECRET): boolean {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"), "hex");
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface ParsedInboundMessage {
  phoneNumberId: string;
  /** The customer's WhatsApp id (their phone number, digits only). */
  from: string;
  profileName: string | null;
  /** WhatsApp's own message id (wamid...) -- used to ignore a webhook Meta retries. */
  messageId: string;
  receivedAt: Date;
  /** Text the AI can read. Non-text messages are turned into a short description (see describeNonText). */
  text: string;
  type: string;
}

export interface ParsedStatusUpdate {
  phoneNumberId: string;
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  errorMessage: string | null;
}

interface RawWhatsAppMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  location?: { name?: string; address?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
}

/** The AI cannot see images or hear voice notes, so it is told plainly what arrived instead of guessing. */
function describeNonText(m: RawWhatsAppMessage): string {
  switch (m.type) {
    case "text":
      return m.text?.body ?? "";
    case "button":
      return m.button?.text ?? "[the customer tapped a button]";
    case "interactive":
      return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[the customer chose an option]";
    case "image":
      return m.image?.caption ? `[the customer sent an image with the caption: ${m.image.caption}]` : "[the customer sent an image]";
    case "video":
      return m.video?.caption ? `[the customer sent a video with the caption: ${m.video.caption}]` : "[the customer sent a video]";
    case "audio":
      return "[the customer sent a voice note -- you cannot listen to it; politely ask them to type their message]";
    case "document":
      return `[the customer sent a document${m.document?.filename ? `: ${m.document.filename}` : ""}]`;
    case "location":
      return `[the customer shared a location${m.location?.name ? `: ${m.location.name}` : ""}]`;
    case "sticker":
      return "[the customer sent a sticker]";
    default:
      return `[the customer sent a ${m.type ?? "message"} you cannot read]`;
  }
}

/** Extracts every inbound message and delivery-status update from one webhook delivery. Tolerant: malformed pieces are skipped, never thrown on. */
export function parseWhatsAppWebhook(payload: unknown): { messages: ParsedInboundMessage[]; statuses: ParsedStatusUpdate[] } {
  const out = { messages: [] as ParsedInboundMessage[], statuses: [] as ParsedStatusUpdate[] };
  const root = payload as { object?: string; entry?: unknown[] } | null;
  if (!root || root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return out;

  for (const entry of root.entry) {
    const changes = (entry as { changes?: unknown[] })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const c = change as { field?: string; value?: Record<string, unknown> };
      if (c.field !== "messages" || !c.value) continue;
      const value = c.value as {
        metadata?: { phone_number_id?: string };
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: RawWhatsAppMessage[];
        statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string; code?: number }[] }[];
      };
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      for (const m of value.messages ?? []) {
        if (!m.id || !m.from) continue;
        const contact = value.contacts?.find((x) => x.wa_id === m.from);
        const seconds = Number(m.timestamp);
        out.messages.push({
          phoneNumberId,
          from: m.from,
          profileName: contact?.profile?.name ?? null,
          messageId: m.id,
          receivedAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
          text: describeNonText(m).trim() || "[empty message]",
          type: m.type ?? "unknown",
        });
      }

      for (const s of value.statuses ?? []) {
        if (!s.id || !s.status) continue;
        if (!["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        const err = s.errors?.[0];
        out.statuses.push({
          phoneNumberId,
          messageId: s.id,
          status: s.status as ParsedStatusUpdate["status"],
          errorMessage: err ? `${err.title ?? "Error"}${err.message ? `: ${err.message}` : ""}${err.code ? ` (code ${err.code})` : ""}` : null,
        });
      }
    }
  }
  return out;
}

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string; code?: number };

/** Sends one free-form text message. Never throws: network and API failures come back as { ok: false }. */
export async function sendWhatsAppText(args: { phoneNumberId: string; token: string; to: string; body: string }): Promise<SendResult> {
  try {
    const res = await fetch(`${graphBase()}/${encodeURIComponent(args.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: args.to,
        type: "text",
        text: { preview_url: false, body: args.body.slice(0, 4000) },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as
      | { messages?: { id?: string }[]; error?: { message?: string; code?: number } }
      | null;
    if (!res.ok || !json?.messages?.[0]?.id) {
      return { ok: false, error: json?.error?.message ?? `WhatsApp API returned HTTP ${res.status}`, code: json?.error?.code };
    }
    return { ok: true, messageId: json.messages[0].id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error contacting WhatsApp" };
  }
}

export interface WhatsAppNumberInfo {
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

/** Used when connecting a channel: proves the phone_number_id + token pair really works before saving it. */
export async function fetchWhatsAppNumberInfo(phoneNumberId: string, token: string): Promise<{ ok: true; info: WhatsAppNumberInfo } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${graphBase()}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as
      | { display_phone_number?: string; verified_name?: string; error?: { message?: string } }
      | null;
    if (!res.ok || !json) return { ok: false, error: json?.error?.message ?? `WhatsApp API returned HTTP ${res.status}` };
    return { ok: true, info: { displayPhoneNumber: json.display_phone_number ?? null, verifiedName: json.verified_name ?? null } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error contacting WhatsApp" };
  }
}
