/**
 * Facebook Messenger and Instagram DMs (Meta Messenger Platform). Same Meta
 * app, same app secret and same signed-webhook scheme as WhatsApp; the
 * payloads differ. Pure functions with no database access.
 *
 * Webhook shape (both products): { object: "page" | "instagram", entry: [{ id, messaging: [...] }] }
 *   - Messenger: entry.id is the Facebook Page id.
 *   - Instagram: entry.id is the Instagram business account id.
 * Each messaging item has sender.id / recipient.id; for a customer's message
 * recipient.id is OUR account (what a Channel.externalId is matched on) and
 * sender.id is the customer's scoped id. Echoes of our own sends
 * (message.is_echo) have the two swapped and are dropped.
 *
 * Sending: POST /me/messages with the account's access token, which Meta
 * resolves to the Page / Instagram account the token belongs to. Both only
 * allow a free-form reply within 24h of the customer's last message.
 */

import { graphBase, type SendResult } from "@/lib/channels/whatsapp";

export type MetaMessagingProvider = "FACEBOOK" | "INSTAGRAM";

export interface ParsedMetaMessage {
  provider: MetaMessagingProvider;
  /** Our Page id / Instagram account id -- matched against Channel.externalId. */
  accountId: string;
  /** The customer's scoped id on this channel. */
  from: string;
  messageId: string;
  receivedAt: Date;
  text: string;
  type: string;
}

export type ParsedMetaStatus =
  | { provider: MetaMessagingProvider; accountId: string; contactId: string; kind: "delivered"; mids: string[] }
  | { provider: MetaMessagingProvider; accountId: string; contactId: string; kind: "read"; watermark: Date };

interface RawAttachment {
  type?: string;
}
interface RawMessaging {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: RawAttachment[];
    quick_reply?: { payload?: string };
    reply_to?: { story?: unknown };
  };
  postback?: { mid?: string; title?: string; payload?: string };
  delivery?: { mids?: string[] };
  read?: { watermark?: number };
}

function describeAttachments(atts: RawAttachment[]): string {
  const type = atts[0]?.type;
  switch (type) {
    case "image":
      return "[the customer sent an image]";
    case "video":
    case "ig_reel":
      return "[the customer sent a video]";
    case "audio":
      return "[the customer sent a voice note -- you cannot listen to it; politely ask them to type their message]";
    case "file":
      return "[the customer sent a file]";
    case "story_mention":
      return "[the customer mentioned the business in their story]";
    case "share":
      return "[the customer shared a post with you]";
    case "location":
      return "[the customer shared a location]";
    default:
      return `[the customer sent a ${type ?? "message"} you cannot read]`;
  }
}

/** Extracts customer messages and delivery/read receipts. Tolerant: malformed pieces are skipped, never thrown on. */
export function parseMetaMessagingWebhook(payload: unknown): { messages: ParsedMetaMessage[]; statuses: ParsedMetaStatus[] } {
  const out = { messages: [] as ParsedMetaMessage[], statuses: [] as ParsedMetaStatus[] };
  const root = payload as { object?: string; entry?: unknown[] } | null;
  if (!root || !Array.isArray(root.entry)) return out;
  const provider: MetaMessagingProvider | null = root.object === "page" ? "FACEBOOK" : root.object === "instagram" ? "INSTAGRAM" : null;
  if (!provider) return out;

  for (const entry of root.entry) {
    const items = (entry as { messaging?: unknown[] })?.messaging;
    if (!Array.isArray(items)) continue;
    for (const raw of items) {
      const m = raw as RawMessaging;
      const sender = m.sender?.id;
      const recipient = m.recipient?.id;
      if (!sender || !recipient) continue;

      if (m.message) {
        if (m.message.is_echo || m.message.is_deleted || !m.message.mid) continue;
        const text = m.message.text?.trim() || (m.message.attachments?.length ? describeAttachments(m.message.attachments) : "");
        if (!text) continue;
        out.messages.push({
          provider,
          accountId: recipient,
          from: sender,
          messageId: m.message.mid,
          receivedAt: typeof m.timestamp === "number" ? new Date(m.timestamp) : new Date(),
          text,
          type: m.message.attachments?.length ? (m.message.attachments[0].type ?? "attachment") : "text",
        });
      } else if (m.postback) {
        const text = (m.postback.title || m.postback.payload || "").trim();
        if (!text) continue;
        out.messages.push({
          provider,
          accountId: recipient,
          from: sender,
          messageId: m.postback.mid || `postback:${sender}:${m.timestamp ?? Date.now()}`,
          receivedAt: typeof m.timestamp === "number" ? new Date(m.timestamp) : new Date(),
          text,
          type: "postback",
        });
      } else if (m.delivery?.mids?.length) {
        // delivery/read receipts: sender is the customer, recipient is us
        out.statuses.push({ provider, accountId: recipient, contactId: sender, kind: "delivered", mids: m.delivery.mids });
      } else if (typeof m.read?.watermark === "number") {
        out.statuses.push({ provider, accountId: recipient, contactId: sender, kind: "read", watermark: new Date(m.read.watermark) });
      }
    }
  }
  return out;
}

/** Sends one free-form text reply. Never throws: network and API failures come back as { ok: false }. */
export async function sendMetaMessage(args: { token: string; to: string; body: string }): Promise<SendResult> {
  try {
    const res = await fetch(`${graphBase()}/me/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: args.to },
        messaging_type: "RESPONSE",
        // Instagram caps a text at 1000 bytes, Messenger at 2000 chars; 900 chars is safe for both even in Arabic (2 bytes/char).
        message: { text: args.body.slice(0, 900) },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { message_id?: string; error?: { message?: string; code?: number } } | null;
    if (!res.ok || !json?.message_id) {
      return { ok: false, error: json?.error?.message ?? `Meta API returned HTTP ${res.status}`, code: json?.error?.code };
    }
    return { ok: true, messageId: json.message_id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error contacting Meta" };
  }
}

/** Used when connecting a channel: proves the account id + token pair really works before saving it. */
export async function fetchMetaAccountInfo(
  provider: MetaMessagingProvider,
  accountId: string,
  token: string
): Promise<{ ok: true; displayName: string } | { ok: false; error: string }> {
  try {
    const fields = provider === "FACEBOOK" ? "name" : "username,name";
    const res = await fetch(`${graphBase()}/${encodeURIComponent(accountId)}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as { name?: string; username?: string; error?: { message?: string } } | null;
    if (!res.ok || !json) return { ok: false, error: json?.error?.message ?? `Meta API returned HTTP ${res.status}` };
    const displayName = provider === "INSTAGRAM" && json.username ? `@${json.username}` : (json.name ?? accountId);
    return { ok: true, displayName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error contacting Meta" };
  }
}

/** Best effort: the customer's name, so the inbox does not show an anonymous id. Returns null on any failure. */
export async function fetchMetaContactName(provider: MetaMessagingProvider, contactId: string, token: string): Promise<string | null> {
  try {
    const fields = provider === "FACEBOOK" ? "name" : "name,username";
    const res = await fetch(`${graphBase()}/${encodeURIComponent(contactId)}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { name?: string; username?: string } | null;
    return json?.name || (json?.username ? `@${json.username}` : null);
  } catch {
    return null;
  }
}
