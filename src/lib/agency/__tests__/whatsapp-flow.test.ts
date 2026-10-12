import { createHmac, randomBytes } from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { seedMinimalFixtures, createTenantWithOwner, resetDb } from "@/lib/actions/__tests__/test-helpers";

// Real WhatsApp/Claude are never contacted: a local HTTP server stands in for Meta's Graph API and the AI reply is scripted.
process.env.META_APP_SECRET = "test-app-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "test-verify-token";
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const pendingAfter: (() => Promise<void>)[] = [];
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => Promise<void>) => {
    pendingAfter.push(fn);
  },
}));

const mockReply = vi.fn();
vi.mock("@/lib/ai/respond", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/respond")>()),
  generateAiReply: (ctx: unknown) => mockReply(ctx),
}));

const { POST, GET } = await import("@/app/api/webhooks/whatsapp/route");
const { encryptSecret } = await import("@/lib/crypto");
const { deliverMessage } = await import("@/lib/channels/dispatch");

// ---- mock Graph API ------------------------------------------------------------------
let graph: http.Server;
let sent: { phoneNumberId: string; auth: string; body: { to: string; text: { body: string } } }[] = [];
let graphFails = false;

beforeAll(async () => {
  graph = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (graphFails) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Recipient not in allowed list", code: 131030 } }));
        return;
      }
      sent.push({ phoneNumberId: req.url!.split("/")[1], auth: String(req.headers.authorization), body: JSON.parse(raw) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: [{ id: `wamid.OUT${sent.length}` }] }));
    });
  });
  await new Promise<void>((r) => graph.listen(0, "127.0.0.1", r));
  process.env.WHATSAPP_API_BASE = `http://127.0.0.1:${(graph.address() as AddressInfo).port}`;
});
afterAll(() => graph.close());

// ---- fixtures -----------------------------------------------------------------------
let tenantId: string;
const PHONE_ID = "555000111";
const TOKEN = "EAAG-test-token-1234567890";

beforeEach(async () => {
  const { product } = await seedMinimalFixtures();
  const { tenant } = await createTenantWithOwner({ productId: product.id, subdomain: "wa-tenant" });
  tenantId = tenant.id;
  await db.channel.create({
    data: { tenantId, provider: "WHATSAPP", status: "CONNECTED", externalId: PHONE_ID, apiToken: encryptSecret(TOKEN), displayName: "Test" },
  });
  await db.aiSettings.create({ data: { tenantId, approvalRequired: false } });
  sent = [];
  graphFails = false;
  pendingAfter.length = 0;
  mockReply.mockReset();
  mockReply.mockResolvedValue({
    body: "Hello! How can I help?",
    language: "EN",
    requiresApproval: false,
    extracted: { name: null, needs: null, readyForHandoff: false, needsHuman: false, proposedSlotId: null },
  });
});

afterEach(async () => {
  await resetDb();
});

function webhookBody(opts: { id: string; text: string; from?: string; statuses?: object[] }) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: PHONE_ID },
              contacts: [{ wa_id: opts.from ?? "96170111222", profile: { name: "Rami" } }],
              messages: opts.text ? [{ from: opts.from ?? "96170111222", id: opts.id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: opts.text } }] : undefined,
              statuses: opts.statuses,
            },
          },
        ],
      },
    ],
  });
}

async function post(body: string, secret = "test-app-secret") {
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  const req = new Request("http://localhost/api/webhooks/whatsapp", { method: "POST", body, headers: { "x-hub-signature-256": sig } });
  // @ts-expect-error NextRequest is a Request subclass; the handler only needs text() and headers
  const res = await POST(req);
  while (pendingAfter.length) await pendingAfter.shift()!();
  return res;
}

describe("webhook verification", () => {
  it("echoes the challenge only for the right verify token", async () => {
    const ok = await GET({ nextUrl: new URL("http://x/?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=abc") } as never);
    expect(await ok.text()).toBe("abc");
    const bad = await GET({ nextUrl: new URL("http://x/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc") } as never);
    expect(bad.status).toBe(403);
  });

  it("rejects an unsigned or wrongly signed message and stores nothing", async () => {
    const res = await post(webhookBody({ id: "wamid.1", text: "hi" }), "attacker-secret");
    expect(res.status).toBe(401);
    expect(await db.message.count()).toBe(0);
  });
});

describe("inbound message to AI reply", () => {
  it("stores the customer message, replies over WhatsApp, and alerts the admin of the new conversation", async () => {
    const res = await post(webhookBody({ id: "wamid.1", text: "hi there" }));
    expect(res.status).toBe(200);

    const convo = await db.conversation.findFirstOrThrow({ where: { tenantId }, include: { messages: { orderBy: { createdAt: "asc" } }, nexarisClient: true } });
    expect(convo.externalContactId).toBe("96170111222");
    expect(convo.nexarisClient.phone).toBe("+96170111222");
    expect(convo.messages.map((m) => [m.sender, m.body])).toEqual([["CUSTOMER", "hi there"], ["AI", "Hello! How can I help?"]]);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ phoneNumberId: PHONE_ID, auth: `Bearer ${TOKEN}`, body: { to: "96170111222", text: { body: "Hello! How can I help?" } } });
    expect(convo.messages[1]).toMatchObject({ deliveryStatus: "SENT", externalId: "wamid.OUT1" });

    const alerts = await db.tenantAlert.findMany({ where: { tenantId } });
    expect(alerts.map((a) => a.type)).toEqual(["NEW_CONVERSATION"]);
  });

  it("ignores a webhook Meta delivers twice", async () => {
    const body = webhookBody({ id: "wamid.DUP", text: "hi" });
    await post(body);
    await post(body);
    expect(await db.message.count({ where: { sender: "CUSTOMER" } })).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("keeps one conversation for a returning customer and passes the whole thread to the AI", async () => {
    await post(webhookBody({ id: "wamid.1", text: "first" }));
    await post(webhookBody({ id: "wamid.2", text: "second" }));
    expect(await db.conversation.count({ where: { tenantId } })).toBe(1);
    const ctx = mockReply.mock.calls[1][0] as { history: { sender: string; body: string }[] };
    expect(ctx.history.map((h) => h.body)).toEqual(["first", "Hello! How can I help?", "second"]);
  });

  it("holds a reply that needs approval: nothing is sent and the admin is alerted", async () => {
    mockReply.mockResolvedValue({
      body: "The price is 300.",
      language: "EN",
      requiresApproval: true,
      extracted: { name: null, needs: null, readyForHandoff: false, needsHuman: false, proposedSlotId: null },
    });
    await post(webhookBody({ id: "wamid.1", text: "how much?" }));
    expect(sent).toHaveLength(0);
    const ai = await db.message.findFirstOrThrow({ where: { sender: "AI" } });
    expect(ai.status).toBe("PENDING_APPROVAL");
    expect(ai.deliveryStatus).toBeNull();
    expect((await db.tenantAlert.findMany({ where: { tenantId } })).map((a) => a.type).sort()).toEqual(["NEEDS_ATTENTION", "NEW_CONVERSATION"]);

    // approving it later sends it exactly once, even if delivery is attempted twice
    await db.message.update({ where: { id: ai.id }, data: { status: "APPROVED" } });
    await deliverMessage(tenantId, ai.id);
    await deliverMessage(tenantId, ai.id);
    expect(sent).toHaveLength(1);
  });

  it("creates a pending meeting request and alerts the admin when the AI offers a slot", async () => {
    const slot = await db.meetingSlot.create({ data: { tenantId, startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000), status: "AVAILABLE" } });
    mockReply.mockResolvedValue({
      body: "Does tomorrow work?",
      language: "EN",
      requiresApproval: false,
      extracted: { name: "Rami", needs: "logo", readyForHandoff: true, needsHuman: false, proposedSlotId: slot.id },
    });
    await post(webhookBody({ id: "wamid.1", text: "I want a logo" }));

    const request = await db.meetingRequest.findFirstOrThrow({ where: { tenantId } });
    expect(request.slotId).toBe(slot.id);
    const convo = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    expect(convo.stage).toBe("MEETING_PENDING");
    expect((await db.tenantAlert.findMany({ where: { tenantId } })).map((a) => a.type)).toContain("MEETING_REQUESTED");
    expect((await db.nexarisClient.findFirstOrThrow({ where: { tenantId } })).tag).toBe("INTERESTED");
  });

  it("pauses the AI when it asks for a human, and stays silent on the next customer message", async () => {
    mockReply.mockResolvedValue({
      body: "A team member will take it from here.",
      language: "EN",
      requiresApproval: false,
      extracted: { name: null, needs: null, readyForHandoff: false, needsHuman: true, proposedSlotId: null },
    });
    await post(webhookBody({ id: "wamid.1", text: "I want to speak to a person" }));
    expect((await db.conversation.findFirstOrThrow({ where: { tenantId } })).aiPaused).toBe(true);
    expect(sent).toHaveLength(1);

    await post(webhookBody({ id: "wamid.2", text: "hello??" }));
    expect(mockReply).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    expect(await db.message.count({ where: { sender: "CUSTOMER" } })).toBe(2);
  });

  it("records a failed send on the message and alerts the admin, without losing the customer message", async () => {
    graphFails = true;
    await post(webhookBody({ id: "wamid.1", text: "hi" }));
    const ai = await db.message.findFirstOrThrow({ where: { sender: "AI" } });
    expect(ai.deliveryStatus).toBe("FAILED");
    expect(ai.failureReason).toContain("allowed list");
    expect((await db.tenantAlert.findMany({ where: { tenantId } })).map((a) => a.type)).toContain("SEND_FAILED");

    // fixing the problem and retrying sends it
    graphFails = false;
    await deliverMessage(tenantId, ai.id);
    expect((await db.message.findUniqueOrThrow({ where: { id: ai.id } })).deliveryStatus).toBe("SENT");
  });

  it("refuses to send outside WhatsApp's 24-hour window", async () => {
    await post(webhookBody({ id: "wamid.1", text: "hi" }));
    const ai = await db.message.findFirstOrThrow({ where: { sender: "AI" } });
    await db.conversation.updateMany({ where: { tenantId }, data: { lastCustomerMessageAt: new Date(Date.now() - 25 * 3_600_000) } });
    const human = await db.message.create({ data: { conversationId: ai.conversationId, sender: "HUMAN", body: "late reply", status: "APPROVED" } });
    const result = await deliverMessage(tenantId, human.id);
    expect(result.ok).toBe(false);
    expect((await db.message.findUniqueOrThrow({ where: { id: human.id } })).deliveryStatus).toBe("FAILED");
    expect(sent).toHaveLength(1);
  });

  it("ignores a webhook for a phone number no tenant has connected", async () => {
    const body = webhookBody({ id: "wamid.1", text: "hi" }).replace(PHONE_ID, "999999");
    const res = await post(body);
    expect(res.status).toBe(200);
    expect(await db.message.count()).toBe(0);
  });
});

describe("delivery status updates", () => {
  it("moves a sent message to delivered then read, and never backwards", async () => {
    await post(webhookBody({ id: "wamid.1", text: "hi" }));
    const status = (s: string) => webhookBody({ id: "", text: "", statuses: [{ id: "wamid.OUT1", status: s }] });
    await post(status("read"));
    await post(status("delivered"));
    expect((await db.message.findFirstOrThrow({ where: { sender: "AI" } })).deliveryStatus).toBe("READ");
  });

  it("marks a message failed and alerts when WhatsApp reports a failure", async () => {
    await post(webhookBody({ id: "wamid.1", text: "hi" }));
    await post(webhookBody({ id: "", text: "", statuses: [{ id: "wamid.OUT1", status: "failed", errors: [{ code: 131047, title: "Re-engagement", message: "outside window" }] }] }));
    const ai = await db.message.findFirstOrThrow({ where: { sender: "AI" } });
    expect(ai.deliveryStatus).toBe("FAILED");
    expect(ai.failureReason).toContain("131047");
    expect((await db.tenantAlert.findMany({ where: { tenantId } })).map((a) => a.type)).toContain("SEND_FAILED");
  });
});
