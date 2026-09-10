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

const { getCompanySettingsAction, updateCompanySettingsAction } = await import("@/lib/actions/marketing-settings");

let tenantId: string;
let ownerId: string;

beforeEach(async () => {
  const { product } = await seedMinimalFixtures();
  const { tenant, owner } = await createTenantWithOwner({ productId: product.id, subdomain: "acme" });
  tenantId = tenant.id;
  ownerId = owner.id;
  mockGetTenantSession.mockResolvedValue({ id: ownerId, tenantId, role: { name: "Agency Owner" } });
});

afterEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("getCompanySettingsAction", () => {
  it("creates a default row on first access instead of returning null", async () => {
    const result = await getCompanySettingsAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.tenantId).toBe(tenantId);
    expect(result.settings.companyName).toBeNull();
  });
});

describe("updateCompanySettingsAction", () => {
  it("persists company/brand fields and writes an audit log", async () => {
    const result = await updateCompanySettingsAction({
      companyName: "Acme Agency",
      website: "https://acme.example.com",
      primaryColor: "#7C5CFC",
      voiceTone: "Warm and direct",
    });
    expect(result.ok).toBe(true);

    const saved = await db.companySettings.findUnique({ where: { tenantId } });
    expect(saved?.companyName).toBe("Acme Agency");
    expect(saved?.website).toBe("https://acme.example.com");
    expect(saved?.voiceTone).toBe("Warm and direct");

    const audit = await db.auditLog.findFirst({ where: { tenantId, action: "company_settings.updated" } });
    expect(audit).not.toBeNull();
  });

  it("does not leak another tenant's company settings", async () => {
    await updateCompanySettingsAction({ companyName: "Acme Agency" });

    // A second tenant under the same already-seeded product.
    const product = await db.product.findFirst();
    const otherTenant = await db.tenant.create({
      data: { productId: product!.id, companyName: "Other Co", subdomain: "other", status: "ACTIVE" },
    });
    const otherOwnerRole = await db.role.findFirst({ where: { name: "Agency Owner" } });
    const otherOwner = await db.user.create({
      data: {
        email: "owner-other@example.com",
        name: "Other Owner",
        scope: "TENANT",
        status: "ACTIVE",
        tenantId: otherTenant.id,
        roleId: otherOwnerRole!.id,
      },
    });

    mockGetTenantSession.mockResolvedValue({ id: otherOwner.id, tenantId: otherTenant.id, role: { name: "Agency Owner" } });
    const result = await getCompanySettingsAction();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.companyName).toBeNull();
  });
});
