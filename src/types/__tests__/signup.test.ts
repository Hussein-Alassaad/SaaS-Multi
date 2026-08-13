import { describe, it, expect } from "vitest";
import { signupSchema } from "../signup";

const validInput = {
  companyName: "Acme Agency",
  subdomain: "acme",
  ownerName: "Jane Doe",
  email: "jane@acme.example.com",
  password: "correcthorsebattery",
  planId: "plan_123",
  billingCycle: "monthly" as const,
};

describe("signupSchema", () => {
  it("accepts a valid input", () => {
    expect(signupSchema.safeParse(validInput).success).toBe(true);
  });

  it.each([
    ["Acme Inc", "spaces and other chars rejected"],
    ["ACME", "uppercase rejected"],
    ["a", "too short"],
    ["a".repeat(64), "too long"],
  ])("rejects subdomain %s (%s)", (subdomain) => {
    const result = signupSchema.safeParse({ ...validInput, subdomain });
    expect(result.success).toBe(false);
  });

  it("accepts a subdomain with hyphens and numbers", () => {
    expect(signupSchema.safeParse({ ...validInput, subdomain: "acme-2" }).success).toBe(true);
  });

  it.each(["short1", "", "1234567"])("rejects password %s (too short)", (password) => {
    expect(signupSchema.safeParse({ ...validInput, password }).success).toBe(false);
  });

  it("accepts an 8-character password", () => {
    expect(signupSchema.safeParse({ ...validInput, password: "12345678" }).success).toBe(true);
  });

  it.each(["not-an-email", "missing@", "@missing.com", "no-at-sign.com"])(
    "rejects invalid email %s",
    (email) => {
      expect(signupSchema.safeParse({ ...validInput, email }).success).toBe(false);
    }
  );

  it("rejects an invalid billingCycle", () => {
    expect(signupSchema.safeParse({ ...validInput, billingCycle: "weekly" }).success).toBe(false);
  });

  it("rejects an empty planId", () => {
    expect(signupSchema.safeParse({ ...validInput, planId: "" }).success).toBe(false);
  });
});
