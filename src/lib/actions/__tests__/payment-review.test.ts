import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { seedMinimalFixtures, resetDb } from "./test-helpers";

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  getSession: () => mockGetSession(),
}));
// revalidatePath() requires a real Next.js request/build context that
// doesn't exist when calling the action directly from a test — the
// transaction/state-transition logic being tested here doesn't depend on
// it, so it's stubbed out rather than restructuring the action.
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const { approvePaymentAction, rejectPaymentAction } = await import("@/lib/actions/payment-review");

let tenantId: string;
let paymentId: string;
let adminId: string;

async function createPendingPayment() {
  const { product, plan } = await seedMinimalFixtures();
  const tenant = await db.tenant.create({
    data: { productId: product.id, companyName: "Acme", subdomain: "acme", status: "TRIAL" },
  });
  await db.subscription.create({
    data: { tenantId: tenant.id, planId: plan.id, status: "TRIALING", billingCycle: "monthly" },
  });
  const payment = await db.payment.create({
    data: { tenantId: tenant.id, amountCents: 2900, status: "PENDING", method: "omt_wish", proofReference: "OMT-1" },
  });
  // Payment.reviewedById has a real FK to User -- the reviewing admin must
  // exist as a row, not just be an id string in the mocked session.
  const admin = await db.user.create({
    data: { email: "admin1@platform.example.com", name: "Admin One", scope: "PLATFORM", status: "ACTIVE" },
  });
  return { tenantId: tenant.id, paymentId: payment.id, adminId: admin.id };
}

beforeEach(async () => {
  const created = await createPendingPayment();
  tenantId = created.tenantId;
  paymentId = created.paymentId;
  adminId = created.adminId;
});

afterEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

describe("approvePaymentAction", () => {
  it("flips Tenant TRIAL->ACTIVE and Payment PENDING->SUCCEEDED together", async () => {
    mockGetSession.mockResolvedValue({ id: adminId, role: { name: "Finance" } });

    const result = await approvePaymentAction(paymentId);
    expect(result.ok).toBe(true);

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    const subscription = await db.subscription.findFirst({ where: { tenantId } });

    expect(tenant?.status).toBe("ACTIVE");
    expect(payment?.status).toBe("SUCCEEDED");
    expect(payment?.reviewedById).toBe(adminId);
    expect(subscription?.status).toBe("ACTIVE");
  });

  it("rejects when the actor's role lacks billing:edit", async () => {
    mockGetSession.mockResolvedValue({ id: "u2", role: { name: "Support" } });

    await expect(approvePaymentAction(paymentId)).rejects.toThrow(/forbidden/i);

    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    expect(payment?.status).toBe("PENDING");
  });
});

describe("rejectPaymentAction", () => {
  it("marks the payment FAILED and leaves the tenant in TRIAL", async () => {
    mockGetSession.mockResolvedValue({ id: adminId, role: { name: "Finance" } });

    const result = await rejectPaymentAction(paymentId, "invalid reference");
    expect(result.ok).toBe(true);

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    const payment = await db.payment.findUnique({ where: { id: paymentId } });

    expect(tenant?.status).toBe("TRIAL");
    expect(payment?.status).toBe("FAILED");
  });
});
