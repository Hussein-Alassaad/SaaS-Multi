import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { proxy } from "./proxy";
import { db } from "@/lib/db";

const SECRET = new TextEncoder().encode("dev-only-insecure-fallback-secret-do-not-use-in-production");

async function makeToken(scope: "PLATFORM" | "TENANT") {
  return new SignJWT({ userId: "u1", role: "Owner", scope })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(SECRET);
}

function requestWithCookie(url: string, token?: string, ip?: string) {
  const req = new NextRequest(new URL(url, "http://localhost:3000"));
  if (token) req.cookies.set("admin_session", token);
  if (ip) req.headers.set("x-forwarded-for", ip);
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

  describe("IP allowlist", () => {
    afterEach(async () => {
      await db.ipAllowlistEntry.deleteMany({});
    });

    it("allows any IP on /admin when the allowlist is empty", async () => {
      const token = await makeToken("PLATFORM");
      const res = await proxy(requestWithCookie("/admin/tenants", token, "9.9.9.9"));
      expect(res.status).not.toBe(403);
    });

    it("blocks a PLATFORM session on /admin from an IP outside a configured allowlist", async () => {
      await db.ipAllowlistEntry.create({ data: { cidr: "203.0.113.0/24" } });
      const token = await makeToken("PLATFORM");
      const res = await proxy(requestWithCookie("/admin/tenants", token, "9.9.9.9"));
      expect(res.status).toBe(403);
    });

    it("allows a PLATFORM session on /admin from an IP inside a configured CIDR range", async () => {
      await db.ipAllowlistEntry.create({ data: { cidr: "203.0.113.0/24" } });
      const token = await makeToken("PLATFORM");
      const res = await proxy(requestWithCookie("/admin/tenants", token, "203.0.113.42"));
      expect(res.status).not.toBe(403);
    });

    it("allows a PLATFORM session on /admin from an exact bare-IP allowlist entry", async () => {
      await db.ipAllowlistEntry.create({ data: { cidr: "198.51.100.7" } });
      const token = await makeToken("PLATFORM");
      const res = await proxy(requestWithCookie("/admin/tenants", token, "198.51.100.7"));
      expect(res.status).not.toBe(403);
    });

    it("does not apply the allowlist to tenant-scoped paths", async () => {
      await db.ipAllowlistEntry.create({ data: { cidr: "203.0.113.0/24" } });
      const token = await makeToken("TENANT");
      const res = await proxy(requestWithCookie("/agency", token, "9.9.9.9"));
      expect(res.status).not.toBe(403);
    });
  });
});
