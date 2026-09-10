import { createHash } from "crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { seedMinimalFixtures, createTenantWithOwner, resetDb } from "./test-helpers";

const mockGetTenantSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getTenantSession: () => mockGetTenantSession(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const { generateApiKeyAction, revokeApiKeyAction, listApiKeysAction } = await import("@/lib/actions/marketing-api-keys");

let tenantAId: string;
let tenantAOwnerId: string;
let tenantBId: string;
let tenantBOwnerId: string;

function asTenantA() {
  mockGetTenantSession.mockResolvedValue({ id: tenantAOwnerId, tenantId: tenantAId, role: { name: "Agency Owner" } });
}
function asTenantB() {
  mockGetTenantSession.mockResolvedValue({ id: tenantBOwnerId, tenantId: tenantBId, role: { name: "Agency Owner" } });
}

beforeEach(async () => {
  const { product } = await seedMinimalFixtures();
  const a = await createTenantWithOwner({ productId: product.id, subdomain: "tenant-a" });
  const b = await createTenantWithOwner({ productId: product.id, subdomain: "tenant-b" });
  tenantAId = a.tenant.id;
  tenantAOwnerId = a.owner.id;
  tenantBId = b.tenant.id;
  tenantBOwnerId = b.owner.id;
});

afterEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("generateApiKeyAction", () => {
  it("returns the raw key once and persists only its hash", async () => {
    asTenantA();
    const result = await generateApiKeyAction("CRM integration");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawKey).toMatch(/^mk_live_/);

    const stored = await db.tenantApiKey.findFirst({ where: { tenantId: tenantAId } });
    expect(stored?.keyHash).toBe(createHash("sha256").update(result.rawKey).digest("hex"));
    expect(stored?.keyPreview).toBe(result.rawKey.slice(-4));
  });

  it("rejects an empty name", async () => {
    asTenantA();
    const result = await generateApiKeyAction("   ");
    expect(result.ok).toBe(false);
  });
});

describe("listApiKeysAction", () => {
  it("only returns keys belonging to the caller's tenant, and never the raw key", async () => {
    asTenantA();
    await generateApiKeyAction("Key A");

    asTenantB();
    await generateApiKeyAction("Key B");

    asTenantA();
    const result = await listApiKeysAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keys).toHaveLength(1);
    expect(result.keys[0].name).toBe("Key A");
    expect(JSON.stringify(result.keys)).not.toContain("mk_live_");
  });

  it("excludes revoked keys", async () => {
    asTenantA();
    const created = await generateApiKeyAction("Key A");
    if (!created.ok) throw new Error("create failed");

    const listBefore = await listApiKeysAction();
    if (!listBefore.ok) throw new Error("list failed");
    const keyId = (await db.tenantApiKey.findFirstOrThrow({ where: { tenantId: tenantAId } })).id;

    await revokeApiKeyAction(keyId);
    const listAfter = await listApiKeysAction();
    expect(listAfter.ok).toBe(true);
    if (!listAfter.ok) return;
    expect(listAfter.keys).toHaveLength(0);
  });
});

describe("revokeApiKeyAction", () => {
  it("refuses to revoke another tenant's key", async () => {
    asTenantA();
    await generateApiKeyAction("Key A");
    const keyId = (await db.tenantApiKey.findFirstOrThrow({ where: { tenantId: tenantAId } })).id;

    asTenantB();
    const result = await revokeApiKeyAction(keyId);
    expect(result.ok).toBe(false);

    const stillActive = await db.tenantApiKey.findUnique({ where: { id: keyId } });
    expect(stillActive?.revokedAt).toBeNull();
  });
});
