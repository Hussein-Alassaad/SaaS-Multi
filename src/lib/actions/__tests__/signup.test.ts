import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTenantAndOwner } from "@/lib/actions/signup";
import { verifyPassword } from "@/lib/auth";
import { agencyRoleDbName } from "@/lib/agency-permissions";
import { seedMinimalFixtures, resetDb } from "./test-helpers";
import type { SignupInput } from "@/types/signup";

let plan: { id: string };

beforeEach(async () => {
  const fixtures = await seedMinimalFixtures();
  plan = fixtures.plan;
});

afterEach(async () => {
  await resetDb();
});

function makeInput(overrides: Partial<SignupInput> = {}): SignupInput {
  return {
    companyName: "Acme Agency",
    subdomain: "acme",
    ownerName: "Jane Doe",
    email: "jane@acme.example.com",
    password: "correcthorsebattery",
    planId: plan.id,
    billingCycle: "monthly",
    ...overrides,
  };
}

describe("createTenantAndOwner", () => {
  it("creates a Tenant (TRIAL), owner User, and TRIALING Subscription", async () => {
    const { tenant, owner } = await createTenantAndOwner(makeInput());

    expect(tenant.status).toBe("TRIAL");
    expect(owner.email).toBe("jane@acme.example.com");

    const subscription = await db.subscription.findFirst({ where: { tenantId: tenant.id } });
    expect(subscription?.status).toBe("TRIALING");
    expect(subscription?.planId).toBe(plan.id);
  });

  it("hashes the password, never stores it in plaintext", async () => {
    const { owner } = await createTenantAndOwner(makeInput({ password: "correcthorsebattery" }));
    const fresh = await db.user.findUnique({ where: { id: owner.id } });

    expect(fresh?.passwordHash).not.toBe("correcthorsebattery");
    expect(await verifyPassword("correcthorsebattery", fresh!.passwordHash!)).toBe(true);
  });

  it("assigns the seeded Agency Owner role", async () => {
    const { owner } = await createTenantAndOwner(makeInput());
    const fresh = await db.user.findUnique({ where: { id: owner.id }, include: { role: true } });

    expect(fresh?.role?.name).toBe(agencyRoleDbName("Owner"));
  });

  it("rejects a duplicate subdomain", async () => {
    await createTenantAndOwner(makeInput({ email: "first@acme.example.com" }));

    await expect(
      createTenantAndOwner(makeInput({ email: "second@acme.example.com" }))
    ).rejects.toThrow(/workspace URL is already taken/i);
  });

  it("rejects a duplicate email", async () => {
    await createTenantAndOwner(makeInput({ subdomain: "acme-one" }));

    await expect(
      createTenantAndOwner(makeInput({ subdomain: "acme-two" }))
    ).rejects.toThrow(/account with that email already exists/i);
  });

  it("rejects an unknown planId", async () => {
    await expect(createTenantAndOwner(makeInput({ planId: "does-not-exist" }))).rejects.toThrow(
      /plan is not available/i
    );
  });
});
