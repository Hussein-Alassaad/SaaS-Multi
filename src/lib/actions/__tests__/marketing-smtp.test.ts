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
// Real AES-256-GCM needs APP_ENCRYPTION_KEY, which isn't set in the test
// environment -- these tests only care about the action's own logic
// (round-tripping *some* opaque string), so encryption is stubbed reversibly.
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (plaintext: string) => `enc:${plaintext}`,
  decryptSecret: (ciphertext: string) => (ciphertext.startsWith("enc:") ? ciphertext.slice(4) : null),
}));

const mockSendMail = vi.fn();
vi.mock("nodemailer", () => ({
  createTransport: () => ({ sendMail: mockSendMail }),
}));

const { updateSmtpConfigAction, getSmtpConfigAction, testSmtpConnectionAction } = await import(
  "@/lib/actions/marketing-smtp"
);

let tenantId: string;
let ownerId: string;

beforeEach(async () => {
  const { product } = await seedMinimalFixtures();
  const { tenant, owner } = await createTenantWithOwner({ productId: product.id, subdomain: "acme" });
  tenantId = tenant.id;
  ownerId = owner.id;
  mockGetTenantSession.mockResolvedValue({
    id: ownerId,
    tenantId,
    role: { name: "Agency Owner" },
    email: "owner-acme@acme.example.com",
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  await resetDb();
});

const VALID_INPUT = {
  host: "smtp.example.com",
  port: 587,
  username: "campaigns",
  password: "super-secret",
  useTls: true,
  fromEmail: "campaigns@acme.example.com",
  fromName: "Acme Agency",
};

describe("updateSmtpConfigAction", () => {
  it("stores the password encrypted, never in plaintext", async () => {
    const result = await updateSmtpConfigAction(VALID_INPUT);
    expect(result.ok).toBe(true);

    const stored = await db.smtpConfig.findUnique({ where: { tenantId } });
    expect(stored?.passwordEncrypted).not.toBe("super-secret");
    expect(stored?.host).toBe("smtp.example.com");
  });

  it("never returns the password to the client", async () => {
    await updateSmtpConfigAction(VALID_INPUT);
    const result = await getSmtpConfigAction();
    expect(result.ok).toBe(true);
    if (!result.ok || !result.config) return;
    expect(JSON.stringify(result.config)).not.toContain("super-secret");
    expect("passwordEncrypted" in result.config).toBe(false);
  });

  it("rejects an invalid from-email", async () => {
    const result = await updateSmtpConfigAction({ ...VALID_INPUT, fromEmail: "not-an-email" });
    expect(result.ok).toBe(false);
  });
});

describe("testSmtpConnectionAction", () => {
  it("requires a saved config first", async () => {
    const result = await testSmtpConnectionAction();
    expect(result.ok).toBe(false);
  });

  it("records a successful test", async () => {
    await updateSmtpConfigAction(VALID_INPUT);
    mockSendMail.mockResolvedValue({});

    const result = await testSmtpConnectionAction();
    expect(result.ok).toBe(true);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "owner-acme@acme.example.com" })
    );

    const stored = await db.smtpConfig.findUnique({ where: { tenantId } });
    expect(stored?.lastTestOk).toBe(true);
    expect(stored?.lastTestedAt).not.toBeNull();
  });

  it("records a failed test without throwing", async () => {
    await updateSmtpConfigAction(VALID_INPUT);
    mockSendMail.mockRejectedValue(new Error("connection refused"));

    const result = await testSmtpConnectionAction();
    expect(result.ok).toBe(false);

    const stored = await db.smtpConfig.findUnique({ where: { tenantId } });
    expect(stored?.lastTestOk).toBe(false);
  });
});
