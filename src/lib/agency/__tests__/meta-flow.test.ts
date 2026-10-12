import { createHmac, randomBytes } from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { seedMinimalFixtures, createTenantWithOwner, resetDb } from "@/lib/actions/__tests__/test-helpers";

// Same approach as whatsapp-flow.test.ts: a local server stands in for Meta's Graph API and the AI reply is scripted.
// Each webhook post is many round trips to a remote Postgres; the default 15s is too tight for the multi-post tests.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

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

const { POST } = await import("@/app/api/webhooks/meta/route");
const { encryptSecret } = await import("@/lib/crypto");
const { deliverMessage } = await import("@/lib/channels/dispatch");

let graph: http.Server;
let sent: { auth: string; body: { recipient: { id: string }; message: { text: string } } }[] = [];

beforeAll(async () => {
  graph = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      if (req.method === "POST" && req.url === "/me/messages") {
        sent.push({ auth: String(req.headers.authorization), body: JSON.parse(raw) });
        res.end(JSON.stringify({ message_id: `m_out${sent.length}` }));
      } else {
        res.end(JSON.stringify({ name: "Lina Haddad" })); // contact-name lookup
      }
    });
  });
  await new Promise<void>((r) => graph.listen(0, "127.0.0.1", r));
  process.env.WHATSAPP_API_BASE = `http://127.0.0.1:${(graph.address() as AddressInfo).port}`;
});
afterAll(() => graph.close());

let tenantId: string;
const TOKEN = "EAAG-page-token-1234567890";

beforeEach(async () => {
  const { product } = await seedMinimalFixtures();
  const { tenant } = await createTenantWithOwner({ productId: product.id, subdomain: "meta-tenant" });
  tenantId = tenant.id;
  for (const [provider, externalId] of [["FACEBOOK", "PAGE1"], ["INSTAGRAM", "IG1"]] as const) {
    await db.channel.create({ data: { tenantId, provider, status: "CONNECTED", externalId, apiToken: encryptSecret(TOKEN), displayName: provider } });
  }
  await db.aiSettings.create({ data: { tenantId, approvalRequired: false } });
  sent = [];
  pendingAfter.length = 0;
  mockReply.mockReset();
  mockReply.mockResolvedValue({
    body: "Hi! How can I help?",
    language: "EN",
    requiresApproval: false,
    extracted: { name: null, needs: null, readyForHandoff: false, needsHuman: false, proposedSlotId: null },
  });
});

afterEach(async () => {
  await resetDb();
});

async function post(payload: object, secret = "test-app-secret") {
  const body = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  // @ts-expect-error NextRequest is a Request subclass; the handler only needs text() and headers
  const res = await POST(new Request("http://localhost/api/webhooks/meta", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));
  while (pendingAfter.length) await pendingAfter.shift()!();
  return res;
}

const msg = (object: "page" | "instagram", account: string, mid: string, text: string, customer = "CUST1") => ({
  object,
  entry: [{ id: account, messaging: [{ sender: { id: customer }, recipient: { id: account }, timestamp: Date.now(), message: { mid, text } }] }],
});

describe("Messenger and Instagram inbound", () => {
  it("rejects a wrongly signed request", async () => {
    const res = await post(msg("page", "PAGE1", "m_1", "hi"), "attacker");
    expect(res.status).toBe(401);
    expect(await db.message.count()).toBe(0);
  });

  it("answers a Messenger message with the page token, naming the customer from their profile", async () => {
    await post(msg("page", "PAGE1", "m_1", "hello"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ auth: `Bearer ${TOKEN}`, body: { recipient: { id: "CUST1" }, message: { text: "Hi! How can I help?" } } });
    const convo = await db.conversation.findFirstOrThrow({ where: { tenantId }, include: { channel: true, nexarisClient: true } });
    expect(convo.channel.provider).toBe("FACEBOOK");
    expect(convo.nexarisClient.name).toBe("Lina Haddad");
    expect((await db.message.findFirstOrThrow({ where: { sender: "AI" } })).deliveryStatus).toBe("SENT");
  });

  it("routes Instagram to the Instagram channel, separately from Facebook for the same customer id", async () => {
    await post(msg("instagram", "IG1", "m_i", "hey"));
    await post(msg("page", "PAGE1", "m_p", "hey"));
    const convos = await db.conversation.findMany({ where: { tenantId }, include: { channel: true } });
    expect(convos.map((c) => c.channel.provider).sort()).toEqual(["FACEBOOK", "INSTAGRAM"]);
  });

  it("keeps one client and one conversation for a returning customer", async () => {
    await post(msg("instagram", "IG1", "m_1", "first"));
    await post(msg("instagram", "IG1", "m_2", "second"));
    expect(await db.conversation.count({ where: { tenantId } })).toBe(1);
    expect(await db.nexarisClient.count({ where: { tenantId } })).toBe(1);
  });

  it("ignores duplicates, echoes and accounts nobody connected", async () => {
    const p = msg("page", "PAGE1", "m_dup", "hi");
    await post(p);
    await post(p);
    expect(await db.message.count({ where: { sender: "CUSTOMER" } })).toBe(1);

    await post({ object: "page", entry: [{ id: "PAGE1", messaging: [{ sender: { id: "PAGE1" }, recipient: { id: "CUST1" }, message: { mid: "m_echo", text: "ours", is_echo: true } }] }] });
    expect(await db.message.count({ where: { sender: "CUSTOMER" } })).toBe(1);

    await post(msg("page", "UNKNOWN", "m_u", "hi"));
    expect(await db.message.count({ where: { sender: "CUSTOMER" } })).toBe(1);
  });

  it("marks delivery and read from receipts", async () => {
    await post(msg("page", "PAGE1", "m_1", "hi"));
    const ai = await db.message.findFirstOrThrow({ where: { sender: "AI" } });
    expect(ai.externalId).toBe("m_out1");

    await post({ object: "page", entry: [{ id: "PAGE1", messaging: [{ sender: { id: "CUST1" }, recipient: { id: "PAGE1" }, delivery: { mids: ["m_out1"] } }] }] });
    expect((await db.message.findUniqueOrThrow({ where: { id: ai.id } })).deliveryStatus).toBe("DELIVERED");

    await post({ object: "page", entry: [{ id: "PAGE1", messaging: [{ sender: { id: "CUST1" }, recipient: { id: "PAGE1" }, read: { watermark: Date.now() + 60_000 } }] }] });
    expect((await db.message.findUniqueOrThrow({ where: { id: ai.id } })).deliveryStatus).toBe("READ");
  });

  it("refuses to send outside the 24-hour window and says which channel", async () => {
    await post(msg("instagram", "IG1", "m_1", "hi"));
    await db.conversation.updateMany({ where: { tenantId }, data: { lastCustomerMessageAt: new Date(Date.now() - 30 * 3_600_000) } });
    const convo = await db.conversation.findFirstOrThrow({ where: { tenantId } });
    const human = await db.message.create({ data: { conversationId: convo.id, sender: "HUMAN", body: "late", status: "APPROVED" } });
    const result = await deliverMessage(tenantId, human.id);
    expect(result.ok).toBe(false);
    expect((await db.message.findUniqueOrThrow({ where: { id: human.id } })).failureReason).toContain("Instagram");
    expect(sent).toHaveLength(1);
  });
});
