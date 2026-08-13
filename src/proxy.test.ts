import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { proxy } from "./proxy";

const SECRET = new TextEncoder().encode("dev-only-insecure-fallback-secret-do-not-use-in-production");

async function makeToken(scope: "PLATFORM" | "TENANT") {
  return new SignJWT({ userId: "u1", role: "Owner", scope })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(SECRET);
}

function requestWithCookie(url: string, token?: string) {
  const req = new NextRequest(new URL(url, "http://localhost:3000"));
  if (token) req.cookies.set("admin_session", token);
  return req;
}

describe("proxy", () => {
  beforeAll(() => {
    delete process.env.AUTH_SECRET;
  });

  it("redirects to /login when no cookie is present on an admin path", async () => {
    const res = await proxy(requestWithCookie("/admin/tenants"));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects to /agency-login when no cookie is present on an agency path", async () => {
    const res = await proxy(requestWithCookie("/agency"));
    expect(res.headers.get("location")).toContain("/agency-login");
  });

  it("allows a PLATFORM-scoped session on an admin path", async () => {
    const token = await makeToken("PLATFORM");
    const res = await proxy(requestWithCookie("/admin/tenants", token));
    expect(res.headers.get("location")).toBeNull();
  });

  it("allows a TENANT-scoped session on an agency path", async () => {
    const token = await makeToken("TENANT");
    const res = await proxy(requestWithCookie("/agency", token));
    expect(res.headers.get("location")).toBeNull();
  });

  it("rejects a TENANT-scoped session on an admin path (the fixed cross-scope bug)", async () => {
    const token = await makeToken("TENANT");
    const res = await proxy(requestWithCookie("/admin/tenants", token));
    expect(res.headers.get("location")).toContain("/login");
  });

  it("rejects a PLATFORM-scoped session on an agency path", async () => {
    const token = await makeToken("PLATFORM");
    const res = await proxy(requestWithCookie("/agency", token));
    expect(res.headers.get("location")).toContain("/agency-login");
  });
});
