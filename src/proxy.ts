import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

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
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL(loginPath, request.url));
  }
}

export const config = {
  matcher: ["/admin/:path*", "/agency/:path*", "/outreach/:path*"],
};
