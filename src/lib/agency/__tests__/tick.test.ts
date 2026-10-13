import { randomBytes } from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { seedMinimalFixtures, createTenantWithOwner, resetDb } from "@/lib/actions/__tests__/test-helpers";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });
process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { sendMeetingReminders, alertUnansweredCustomers } = await import("@/lib/agency/tick");
const { normalizePhone } = await import("@/lib/agency/inbound");
const { buildSystemPrompt } = await import("@/lib/ai/respond");
const { encryptSecret } = await import("@/lib/crypto");

let graph: http.Server;
let sent: { to: string; text: string }[] = [];
beforeAll(async () => {
  graph = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw);
      sent.push({ to: body.to, text: body.text.body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: [{ id: `wamid.T${sent.length}` }] }));
    });
  });
  await new Promise<void>((r) => graph.listen(0, "127.0.0.1", r));
  process.env.WHATSAPP_API_BASE = `http://127.0.0.1:${(graph.address() as AddressInfo).port}`;
});
afterAll(() => graph.close());

let tenantId: string;
let channelId: string;
let clientId: string;
const MIN = 60_000;

beforeEach(async () => {
  const { product } = await seedMinimalFixtures();
  const { tenant } = await createTenantWithOwner({ productId: product.id, subdomain: "tick-tenant" });
  tenantId = tenant.id;
  await db.localizationSettings.create({ data: { tenantId, timezone: "Asia/Beirut" } });
  channelId = (await db.channel.create({ data: { tenantId, provider: "WHATSAPP", status: "CONNECTED", externalId: "888", apiToken: encryptSecret("EAAG-test-token-1234567890") } })).id;
  clientId = (await db.nexarisClient.create({ data: { tenantId, name: "Rami", phone: "+96170111222" } })).id;
  sent = [];
});
afterEach(async () => {
  await resetDb();
});

async function conversation(opts: { lastCustomerMinutesAgo: number; aiPaused?: boolean }) {
  return db.conversation.create({
    data: {
      tenantId,
      channelId,
      nexarisClientId: clientId,
      language: "EN",
      externalContactId: "96170111222",
      aiPaused: opts.aiPaused ?? false,
      lastCustomerMessageAt: new Date(Date.now() - opts.lastCustomerMinutesAgo * MIN),
    },
  });
}

async function approvedMeeting(convoId: string, startsInMinutes: number) {
  const slot = await db.meetingSlot.create({
    data: { tenantId, startsAt: new Date(Date.now() + startsInMinutes * MIN), endsAt: new Date(Date.now() + (startsInMinutes + 30) * MIN), status: "BOOKED" },
  });
  return db.meetingRequest.create({ data: { tenantId, conversationId: convoId, nexarisClientId: clientId, slotId: slot.id, status: "APPROVED" } });
}

describe("meeting reminders", () => {
  it("reminds the customer once, about an hour before the call", async () => {
    const convo = await conversation({ lastCustomerMinutesAgo: 30 });
    const meeting = await approvedMeeting(convo.id, 55);

    expect(await sendMeetingReminders()).toEqual({ sent: 1, skipped: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("96170111222");
    expect(sent[0].text).toContain("in about an hour");
    expect((await db.meetingRequest.findUniqueOrThrow({ where: { id: meeting.id } })).reminderSentAt).not.toBeNull();

    expect(await sendMeetingReminders()).toEqual({ sent: 0, skipped: 0 }); // running again does nothing
    expect(sent).toHaveLength(1);
  });

  it("leaves a call that is hours away for later", async () => {
    const convo = await conversation({ lastCustomerMinutesAgo: 30 });
    await approvedMeeting(convo.id, 300);
    expect(await sendMeetingReminders()).toEqual({ sent: 0, skipped: 0 });
    expect(sent).toHaveLength(0);
  });

  it("does not remind about an unconfirmed meeting", async () => {
    const convo = await conversation({ lastCustomerMinutesAgo: 30 });
    const m = await approvedMeeting(convo.id, 55);
    await db.meetingRequest.update({ where: { id: m.id }, data: { status: "PENDING_APPROVAL" } });
    expect(await sendMeetingReminders()).toEqual({ sent: 0, skipped: 0 });
  });

  it("skips quietly, without a failure alert, when the channel's reply window has closed", async () => {
    const convo = await conversation({ lastCustomerMinutesAgo: 30 * 60 });
    await approvedMeeting(convo.id, 55);
    expect(await sendMeetingReminders()).toEqual({ sent: 0, skipped: 1 });
    expect(sent).toHaveLength(0);
    expect(await db.tenantAlert.count({ where: { tenantId } })).toBe(0);
  });
});

describe("unanswered customer alert", () => {
  const customerMessage = (conversationId: string, minutesAgo: number) =>
    db.message.create({ data: { conversationId, sender: "CUSTOMER", body: "hello? anyone?", createdAt: new Date(Date.now() - minutesAgo * MIN) } });

  it("alerts once when a customer has waited more than 10 minutes", async () => {
    const convo = await conversation({ lastCustomerMinutesAgo: 15 });
    await customerMessage(convo.id, 15);
    expect(await alertUnansweredCustomers()).toEqual({ alerted: 1 });
    const alert = await db.tenantAlert.findFirstOrThrow({ where: { tenantId } });
    expect(alert).toMatchObject({ type: "NEEDS_ATTENTION", conversationId: convo.id, title: "A customer is waiting for an answer" });
    expect(await alertUnansweredCustomers()).toEqual({ alerted: 0 });
  });

  it("still alerts when the chat already has the 'new conversation' alert", async () => {
    const convo = await conversation({ lastCustomerMinutesAgo: 15 });
    await customerMessage(convo.id, 15);
    await db.tenantAlert.create({ data: { tenantId, type: "NEW_CONVERSATION", title: "New conversation", body: "x", conversationId: convo.id } });
    expect(await alertUnansweredCustomers()).toEqual({ alerted: 1 });
  });

  it("stays quiet for a recent message, an answered chat, and a chat a person has taken over", async () => {
    const recent = await conversation({ lastCustomerMinutesAgo: 3 });
    await customerMessage(recent.id, 3);

    const answered = await conversation({ lastCustomerMinutesAgo: 15 });
    await customerMessage(answered.id, 15);
    await db.message.create({ data: { conversationId: answered.id, sender: "AI", body: "hi!", createdAt: new Date(Date.now() - 14 * MIN) } });

    const taken = await conversation({ lastCustomerMinutesAgo: 15, aiPaused: true });
    await customerMessage(taken.id, 15);

    expect(await alertUnansweredCustomers()).toEqual({ alerted: 0 });
  });

  it("does not repeat an alert someone already got for that message", async () => {
    const convo = await conversation({ lastCustomerMinutesAgo: 15 });
    await customerMessage(convo.id, 15);
    await db.tenantAlert.create({ data: { tenantId, type: "AI_BUDGET", title: "AI did not reply", body: "x", conversationId: convo.id } });
    expect(await alertUnansweredCustomers()).toEqual({ alerted: 0 });
  });
});

describe("phone numbers and the call prompt", () => {
  it("accepts what customers type and rejects what is not a number", () => {
    expect(normalizePhone("70 123 456")).toBe("70123456");
    expect(normalizePhone("+961 70-123-456")).toBe("+96170123456");
    expect(normalizePhone("call me tomorrow")).toBeUndefined();
    expect(normalizePhone("12345")).toBeUndefined();
    expect(normalizePhone(null)).toBeUndefined();
  });

  const ctx = {
    history: [{ sender: "CUSTOMER" as const, body: "hi" }],
    language: "EN" as const,
    clientName: null,
    knowledgeEntries: [],
    settings: { tone: "FRIENDLY", approvalRequired: true, qualificationRules: "", model: "x", allowEnglish: true, primaryLanguage: "EN" } as never,
    availableSlots: [],
  };
  it("tells the AI to ask for a phone number when it has none, and not to when it does", () => {
    expect(buildSystemPrompt({ ...ctx, clientPhone: null })).toContain("do NOT have the customer's phone number");
    const known = buildSystemPrompt({ ...ctx, clientPhone: "+96170111222" });
    expect(known).toContain("do not ask for it");
    expect(known).not.toContain("do NOT have the customer's phone number");
  });
  it("lets it admit being automated only when asked", () => {
    expect(buildSystemPrompt(ctx)).toContain("Do not bring this up yourself");
  });
});
