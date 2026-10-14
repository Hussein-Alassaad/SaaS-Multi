import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { seedMinimalFixtures, createTenantWithOwner, resetDb } from "@/lib/actions/__tests__/test-helpers";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 });

const { getSetupChecklist, MIN_KNOWLEDGE_ENTRIES } = await import("@/lib/agency/setup");

let tenantId: string;
const SERVER_VARS = ["ANTHROPIC_API_KEY", "META_APP_SECRET", "WHATSAPP_VERIFY_TOKEN", "APP_ENCRYPTION_KEY", "APP_URL", "CRON_SECRET"];

beforeEach(async () => {
  const { product } = await seedMinimalFixtures();
  tenantId = (await createTenantWithOwner({ productId: product.id, subdomain: "setup-tenant" })).tenant.id;
  for (const v of SERVER_VARS) vi.stubEnv(v, "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await resetDb();
});

const byKey = (items: Awaited<ReturnType<typeof getSetupChecklist>>) => Object.fromEntries(items.map((i) => [i.key, i]));

describe("setup checklist", () => {
  it("starts with nothing done and names the missing server settings (never their values)", async () => {
    const items = byKey(await getSetupChecklist(tenantId));
    expect(Object.values(items).every((i) => !i.done)).toBe(true);
    expect(items.server.missing).toEqual(SERVER_VARS);
  });

  it("ticks each step off from real data", async () => {
    await db.localizationSettings.create({ data: { tenantId, timezone: "Asia/Beirut" } });
    for (let i = 0; i < MIN_KNOWLEDGE_ENTRIES; i++) {
      await db.knowledgeEntry.create({ data: { tenantId, title: `Entry ${i}`, category: "FAQ", body: "x" } });
    }
    await db.aiSettings.create({ data: { tenantId, meetingAutoSlots: true } });
    await db.channel.create({ data: { tenantId, provider: "WHATSAPP", status: "CONNECTED", externalId: "123", apiToken: "enc" } });
    for (const v of SERVER_VARS) vi.stubEnv(v, "set");

    const items = byKey(await getSetupChecklist(tenantId));
    expect(items.timezone.done).toBe(true);
    expect(items.knowledge.done).toBe(true);
    expect(items.hours.done).toBe(true);
    expect(items.server.done).toBe(true);
    expect(items.channel.done).toBe(true);
    expect(items.firstChat.done).toBe(false); // no real conversation yet
  });

  it("does not count the default UTC timezone, a demo channel, or too few entries as done", async () => {
    await db.localizationSettings.create({ data: { tenantId, timezone: "UTC" } });
    await db.knowledgeEntry.create({ data: { tenantId, title: "Only one", category: "FAQ", body: "x" } });
    await db.channel.create({ data: { tenantId, provider: "INSTAGRAM", status: "CONNECTED" } }); // the simulated toggle, no credentials

    const items = byKey(await getSetupChecklist(tenantId));
    expect(items.timezone.done).toBe(false);
    expect(items.knowledge.done).toBe(false);
    expect(items.channel.done).toBe(false);
  });
});
