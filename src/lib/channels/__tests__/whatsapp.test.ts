import { createHmac } from "crypto";
import { describe, it, expect } from "vitest";
import { verifyMetaSignature, parseWhatsAppWebhook, isWithinCustomerServiceWindow } from "@/lib/channels/whatsapp";

const SECRET = "test-app-secret";
const sign = (body: string, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("verifyMetaSignature", () => {
  const body = JSON.stringify({ hello: "world" });

  it("accepts a correctly signed body", () => {
    expect(verifyMetaSignature(body, sign(body), SECRET)).toBe(true);
  });
  it("rejects a body changed after signing", () => {
    expect(verifyMetaSignature(body + " ", sign(body), SECRET)).toBe(false);
  });
  it("rejects a signature made with another secret", () => {
    expect(verifyMetaSignature(body, sign(body, "other"), SECRET)).toBe(false);
  });
  it("rejects a missing or malformed header", () => {
    expect(verifyMetaSignature(body, null, SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "nope", SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", SECRET)).toBe(false);
  });
  it("fails closed when no secret is configured", () => {
    expect(verifyMetaSignature(body, sign(body, ""), "")).toBe(false);
  });
});

function payload(value: Record<string, unknown>) {
  return { object: "whatsapp_business_account", entry: [{ id: "waba", changes: [{ field: "messages", value }] }] };
}

describe("parseWhatsAppWebhook", () => {
  it("extracts a text message with the sender's profile name", () => {
    const out = parseWhatsAppWebhook(
      payload({
        metadata: { phone_number_id: "111" },
        contacts: [{ wa_id: "96170123456", profile: { name: "Rami" } }],
        messages: [{ from: "96170123456", id: "wamid.A", timestamp: "1760000000", type: "text", text: { body: "kifak, bade se3er" } }],
      })
    );
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]).toMatchObject({ phoneNumberId: "111", from: "96170123456", profileName: "Rami", messageId: "wamid.A", text: "kifak, bade se3er" });
    expect(out.messages[0].receivedAt.getTime()).toBe(1760000000 * 1000);
  });

  it("describes a voice note instead of dropping it", () => {
    const out = parseWhatsAppWebhook(
      payload({ metadata: { phone_number_id: "111" }, messages: [{ from: "961", id: "wamid.V", timestamp: "1", type: "audio" }] })
    );
    expect(out.messages[0].text).toContain("voice note");
  });

  it("extracts delivery statuses and failure reasons", () => {
    const out = parseWhatsAppWebhook(
      payload({
        metadata: { phone_number_id: "111" },
        statuses: [
          { id: "wamid.X", status: "delivered" },
          { id: "wamid.Y", status: "failed", errors: [{ code: 131047, title: "Re-engagement message", message: "24h window" }] },
          { id: "wamid.Z", status: "deleted" },
        ],
      })
    );
    expect(out.statuses.map((s) => s.status)).toEqual(["delivered", "failed"]);
    expect(out.statuses[1].errorMessage).toContain("131047");
  });

  it("returns nothing for junk instead of throwing", () => {
    expect(parseWhatsAppWebhook(null)).toEqual({ messages: [], statuses: [] });
    expect(parseWhatsAppWebhook({ object: "page", entry: [] })).toEqual({ messages: [], statuses: [] });
    expect(parseWhatsAppWebhook({ object: "whatsapp_business_account", entry: [{ changes: "x" }] })).toEqual({ messages: [], statuses: [] });
  });
});

describe("isWithinCustomerServiceWindow", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  it("is open within 24h and closed after", () => {
    expect(isWithinCustomerServiceWindow(new Date("2026-10-11T13:00:00Z"), now)).toBe(true);
    expect(isWithinCustomerServiceWindow(new Date("2026-10-11T11:59:00Z"), now)).toBe(false);
  });
  it("is closed when the customer never wrote", () => {
    expect(isWithinCustomerServiceWindow(null, now)).toBe(false);
  });
});
