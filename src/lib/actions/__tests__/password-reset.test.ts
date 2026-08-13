import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { requestPasswordResetAction, resetPasswordAction } from "@/lib/actions/password-reset";
import { resetDb } from "./test-helpers";

async function createUser(overrides: Partial<{ email: string; resetToken: string; resetTokenExpiresAt: Date }> = {}) {
  return db.user.create({
    data: {
      email: overrides.email ?? "jane@example.com",
      name: "Jane",
      scope: "TENANT",
      status: "ACTIVE",
      passwordHash: await hashPassword("oldpassword123"),
      resetToken: overrides.resetToken,
      resetTokenExpiresAt: overrides.resetTokenExpiresAt,
    },
  });
}

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

afterEach(async () => {
  await resetDb();
});

describe("requestPasswordResetAction", () => {
  it("returns the same generic message whether or not the email exists", async () => {
    await createUser({ email: "exists@example.com" });

    const existsResult = await requestPasswordResetAction({}, formData({ email: "exists@example.com" }));
    const missingResult = await requestPasswordResetAction({}, formData({ email: "nobody@example.com" }));

    expect(existsResult.message).toBe(missingResult.message);
    expect(existsResult.error).toBeUndefined();
    expect(missingResult.error).toBeUndefined();
  });

  it("sets a resetToken and expiry on the user when the email exists", async () => {
    const user = await createUser({ email: "exists2@example.com" });
    await requestPasswordResetAction({}, formData({ email: "exists2@example.com" }));

    const fresh = await db.user.findUnique({ where: { id: user.id } });
    expect(fresh?.resetToken).toBeTruthy();
    expect(fresh?.resetTokenExpiresAt).toBeInstanceOf(Date);
  });
});

describe("resetPasswordAction", () => {
  it("rejects an expired token", async () => {
    const user = await createUser({
      resetToken: "expired-token",
      resetTokenExpiresAt: new Date(Date.now() - 1000),
    });

    const result = await resetPasswordAction(
      {},
      formData({ token: "expired-token", password: "newpassword123" })
    );

    expect(result.error).toMatch(/invalid or has expired/i);

    const fresh = await db.user.findUnique({ where: { id: user.id } });
    expect(fresh?.resetToken).toBe("expired-token"); // unchanged, reset did not proceed
  });

  it("rejects an unknown token", async () => {
    const result = await resetPasswordAction(
      {},
      formData({ token: "does-not-exist", password: "newpassword123" })
    );
    expect(result.error).toMatch(/invalid or has expired/i);
  });

  it("clears the token after a single successful use", async () => {
    const user = await createUser({
      resetToken: "valid-token",
      resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const result = await resetPasswordAction({}, formData({ token: "valid-token", password: "newpassword123" }));
    expect(result.success).toBe(true);

    const fresh = await db.user.findUnique({ where: { id: user.id } });
    expect(fresh?.resetToken).toBeNull();
    expect(fresh?.resetTokenExpiresAt).toBeNull();

    // Second use of the same token must fail
    const secondAttempt = await resetPasswordAction(
      {},
      formData({ token: "valid-token", password: "anotherpassword123" })
    );
    expect(secondAttempt.error).toMatch(/invalid or has expired/i);
  });
});
