import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { db } from "@/lib/db";
import { ipMatchesCidr } from "@/lib/ip-match";

const SESSION_COOKIE_NAME = "admin_session";

function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production.");
    }
    return new TextEncoder().encode("dev-only-insecure-fallback-secret-do-not-use-in-production");
  }
  return new TextEncoder().encode(secret);
}

// Every tenant-facing product path gets TENANT scope + its own login page.
// Only /admin is PLATFORM scope. Add new product path prefixes here as they
// ship (matches src/lib/sections.ts's PRODUCT_LOGIN_PATH keys).
const TENANT_LOGIN_PATHS: Record<string, string> = {
  "/agency": "/agency-login",
  "/outreach": "/outreach-login",
};

function getRequestIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

// IpAllowlistEntry has a full CRUD admin UI (src/app/(admin)/admin/security)
// but, found in the 2026-09-09 platform review, was never actually enforced
// anywhere -- any admin could add every entry they wanted and it changed
// nothing about who could reach /admin. Enforced here, scoped to /admin only
// (this is an Admin-only control per its own page), and only once a session
// has already been proven valid above -- an allowlist miss is a 403, not a
// redirect to /login, so it reads as "blocked" rather than "please log in".
// Empty table = unrestricted, matching the UI's own "access is unrestricted
// by IP" copy -- this must stay opt-in so nobody locks themselves out by
// simply never having configured it.
async function isIpAllowed(request: NextRequest): Promise<boolean> {
  const entries = await db.ipAllowlistEntry.findMany({ select: { cidr: true } });
  if (entries.length === 0) return true;

  const ip = getRequestIp(request);
  if (!ip) return false;

  return entries.some((e) => ipMatchesCidr(ip, e.cidr));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const tenantPrefix = Object.keys(TENANT_LOGIN_PATHS).find((prefix) => pathname.startsWith(prefix));
  const requiredScope = tenantPrefix ? "TENANT" : "PLATFORM";
  const loginPath = tenantPrefix ? TENANT_LOGIN_PATHS[tenantPrefix] : "/login";
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return NextResponse.redirect(new URL(loginPath, request.url));
  }

  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (payload.scope !== requiredScope) {
      return NextResponse.redirect(new URL(loginPath, request.url));
    }

    if (requiredScope === "PLATFORM" && !(await isIpAllowed(request))) {
      return NextResponse.json({ error: "Access denied from this network." }, { status: 403 });
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL(loginPath, request.url));
  }
}

export const config = {
  matcher: ["/admin/:path*", "/agency/:path*", "/outreach/:path*"],
};
