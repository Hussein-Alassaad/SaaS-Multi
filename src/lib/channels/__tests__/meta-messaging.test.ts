import { describe, it, expect } from "vitest";
import { parseMetaMessagingWebhook } from "@/lib/channels/meta-messaging";

const page = (messaging: object[]) => ({ object: "page", entry: [{ id: "PAGE1", messaging }] });
const insta = (messaging: object[]) => ({ object: "instagram", entry: [{ id: "IG1", messaging }] });

describe("parseMetaMessagingWebhook", () => {
  it("extracts a Messenger text, addressed to our page", () => {
    const out = parseMetaMessagingWebhook(
      page([{ sender: { id: "CUST" }, recipient: { id: "PAGE1" }, timestamp: 1760000000000, message: { mid: "m_1", text: "bade se3er" } }])
    );
    expect(out.messages).toEqual([
      expect.objectContaining({ provider: "FACEBOOK", accountId: "PAGE1", from: "CUST", messageId: "m_1", text: "bade se3er" }),
    ]);
    expect(out.messages[0].receivedAt.getTime()).toBe(1760000000000);
  });

  it("recognises Instagram by the payload object", () => {
    const out = parseMetaMessagingWebhook(insta([{ sender: { id: "C" }, recipient: { id: "IG1" }, message: { mid: "m_2", text: "hi" } }]));
    expect(out.messages[0]).toMatchObject({ provider: "INSTAGRAM", accountId: "IG1" });
  });

  it("drops echoes of our own messages and deleted messages", () => {
    const out = parseMetaMessagingWebhook(
      page([
        { sender: { id: "PAGE1" }, recipient: { id: "CUST" }, message: { mid: "m_e", text: "our reply", is_echo: true } },
        { sender: { id: "CUST" }, recipient: { id: "PAGE1" }, message: { mid: "m_d", is_deleted: true } },
      ])
    );
    expect(out.messages).toEqual([]);
  });

  it("describes attachments the AI cannot read", () => {
    const out = parseMetaMessagingWebhook(
      page([{ sender: { id: "C" }, recipient: { id: "PAGE1" }, message: { mid: "m_a", attachments: [{ type: "audio" }] } }])
    );
    expect(out.messages[0].text).toContain("voice note");
  });

  it("reads delivery receipts and read watermarks", () => {
    const out = parseMetaMessagingWebhook(
      page([
        { sender: { id: "C" }, recipient: { id: "PAGE1" }, delivery: { mids: ["m_x"] } },
        { sender: { id: "C" }, recipient: { id: "PAGE1" }, read: { watermark: 1760000000000 } },
      ])
    );
    expect(out.statuses).toEqual([
      expect.objectContaining({ kind: "delivered", mids: ["m_x"], contactId: "C" }),
      expect.objectContaining({ kind: "read", contactId: "C" }),
    ]);
  });

  it("returns nothing for junk or other objects", () => {
    expect(parseMetaMessagingWebhook(null)).toEqual({ messages: [], statuses: [] });
    expect(parseMetaMessagingWebhook({ object: "whatsapp_business_account", entry: [] })).toEqual({ messages: [], statuses: [] });
    expect(parseMetaMessagingWebhook({ object: "page", entry: [{ messaging: "x" }] })).toEqual({ messages: [], statuses: [] });
  });
});
