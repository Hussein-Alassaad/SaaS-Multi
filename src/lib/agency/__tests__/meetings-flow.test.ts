import { randomBytes } from "crypto";
import http from "http";
import type { AddressInfo } from "net";
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import { db, withTenant } from "@/lib/db";
import { seedMinimalFixtures, createTenantWithOwner, resetDb } from "@/lib/actions/__tests__/test-helpers";

// Each step is several round trips to a remote Postgres; the default 15s is too tight.
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const mockGetTenantSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getTenantSession: () => mockGetTenantSession() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { ensureMeetingSlots } = await import("@/lib/agency/slots");
const { approveMeetingRequestAction, saveMeetingAvailabilityAction, createMeetingSlotAction } = await import("@/lib/actions/agency-meetings");
const { encryptSecret } = await import("@/lib/crypto");

let graph: http.Server;
let sent: { body: { to: string; text: { body: string } } }[] = [];
beforeAll(async () => {
  graph = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      sent.push({ body: JSON.parse(raw) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ messages: [{ id: `wamid.C${sent.length}` }] }));
    });
  });
  await new Promise<void>((r) => graph.listen(0, "127.0.0.1", r));
  process.env.WHATSAPP_API_BASE = `http://127.0.0.1:${(graph.address() as AddressInfo).port}`;
});
afterAll(() => graph.close());

let tenantId: string;
let ownerId: string;

beforeEach(async () => {
  const { product } = await seedMinimalFixtures();
  const { tenant, owner } = await createTenantWithOwner({ productId: product.id, subdomain: "mtg-tenant" });
  tenantId = tenant.id;
  ownerId = owner.id;
  await db.localizationSettings.create({ data: { tenantId, timezone: "Asia/Beirut" } });
  mockGetTenantSession.mockResolvedValue({ id: ownerId, tenantId, role: { name: "Agency Owner" } });
  sent = [];
});
afterEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("automatic availability", () => {
  const config = {
    meetingAutoSlots: true,
    meetingDays: "0,1,2,3,4,5,6",
    meetingStartHour: 10,
    meetingEndHour: 12,
    meetingDurationMin: 60,
    meetingHorizonDays: 3,
    meetingSlotsThrough: null as Date | null,
  };

  it("creates slots once, and does not bring back a slot the owner deleted", async () => {
    await db.aiSettings.create({ data: { tenantId, ...config } });
    const run = async () => {
      const settings = await db.aiSettings.findUniqueOrThrow({ where: { tenantId } });
      await withTenant(tenantId, (tx) => ensureMeetingSlots(tx, tenantId, settings, "Asia/Beirut", new Date("2026-10-14T00:30:00Z")));
    };
    await run();
    const first = await db.meetingSlot.findMany({ where: { tenantId }, orderBy: { startsAt: "asc" } });
    expect(first.length).toBeGreaterThanOrEqual(5); // 3 days x 2 hours, minus any inside the 2h lead time
    expect(first[0].startsAt.toISOString()).toBe("2026-10-14T07:00:00.000Z"); // 10:00 in Beirut

    await db.meetingSlot.delete({ where: { id: first[0].id } });
    await run();
    expect(await db.meetingSlot.count({ where: { tenantId } })).toBe(first.length - 1);
  });

  it("does nothing when switched off", async () => {
    await db.aiSettings.create({ data: { tenantId, ...config, meetingAutoSlots: false } });
    const settings = await db.aiSettings.findUniqueOrThrow({ where: { tenantId } });
    await withTenant(tenantId, (tx) => ensureMeetingSlots(tx, tenantId, settings, "Asia/Beirut"));
    expect(await db.meetingSlot.count({ where: { tenantId } })).toBe(0);
  });

  it("validates the schedule the owner saves", async () => {
    const bad = await saveMeetingAvailabilityAction({ enabled: true, days: [], startHour: 10, endHour: 17, durationMin: 30, horizonDays: 7 });
    expect(bad.ok).toBe(false);
    const backwards = await saveMeetingAvailabilityAction({ enabled: true, days: [1], startHour: 17, endHour: 10, durationMin: 30, horizonDays: 7 });
    expect(backwards.ok).toBe(false);
    const good = await saveMeetingAvailabilityAction({ enabled: true, days: [1, 2, 3], startHour: 9, endHour: 17, durationMin: 30, horizonDays: 7 });
    expect(good.ok).toBe(true);
    const saved = await db.aiSettings.findUniqueOrThrow({ where: { tenantId } });
    expect(saved).toMatchObject({ meetingAutoSlots: true, meetingDays: "1,2,3", meetingStartHour: 9 });
  });
});

describe("manual slots use the business timezone", () => {
  it("stores 3 pm typed by the owner as 3 pm in Beirut, not 3 pm UTC", async () => {
    const res = await createMeetingSlotAction("2026-10-14T15:00", 30);
    expect(res.ok).toBe(true);
    const slot = await db.meetingSlot.findFirstOrThrow({ where: { tenantId } });
    expect(slot.startsAt.toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });
});

describe("confirming a meeting", () => {
  it("books the slot and sends the customer the time on their channel", async () => {
    const channel = await db.channel.create({
      data: { tenantId, provider: "WHATSAPP", status: "CONNECTED", externalId: "777", apiToken: encryptSecret("EAAG-test-token-1234567890") },
    });
    const client = await db.nexarisClient.create({ data: { tenantId, name: "Rami", phone: "+96170111222" } });
    const convo = await db.conversation.create({
      data: { tenantId, channelId: channel.id, nexarisClientId: client.id, language: "EN", externalContactId: "96170111222", lastCustomerMessageAt: new Date() },
    });
    const slot = await db.meetingSlot.create({ data: { tenantId, startsAt: new Date("2026-10-14T12:00:00Z"), endsAt: new Date("2026-10-14T12:30:00Z") } });
    const request = await db.meetingRequest.create({ data: { tenantId, conversationId: convo.id, nexarisClientId: client.id, slotId: slot.id } });

    const res = await approveMeetingRequestAction(request.id);
    expect(res).toMatchObject({ ok: true, customerNotified: true });
    expect((await db.meetingSlot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe("BOOKED");
    expect((await db.conversation.findUniqueOrThrow({ where: { id: convo.id } })).stage).toBe("MEETING_BOOKED");

    expect(sent).toHaveLength(1);
    expect(sent[0].body.to).toBe("96170111222");
    expect(sent[0].body.text.body).toContain("Wednesday");
    expect(sent[0].body.text.body.toLowerCase()).toContain("3:00 pm"); // Beirut time, not UTC
  });

  it("still books when the customer cannot be reached, and says so", async () => {
    const channel = await db.channel.create({ data: { tenantId, provider: "INSTAGRAM", status: "CONNECTED" } }); // simulated: no credentials
    const client = await db.nexarisClient.create({ data: { tenantId, name: "Lina" } });
    const convo = await db.conversation.create({ data: { tenantId, channelId: channel.id, nexarisClientId: client.id, language: "AR_LB" } });
    const slot = await db.meetingSlot.create({ data: { tenantId, startsAt: new Date("2026-10-14T12:00:00Z"), endsAt: new Date("2026-10-14T12:30:00Z") } });
    const request = await db.meetingRequest.create({ data: { tenantId, conversationId: convo.id, nexarisClientId: client.id, slotId: slot.id } });

    const res = await approveMeetingRequestAction(request.id);
    expect(res).toMatchObject({ ok: true, customerNotified: false });
    expect((await db.meetingSlot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe("BOOKED");
    expect(sent).toHaveLength(0);
  });
});
