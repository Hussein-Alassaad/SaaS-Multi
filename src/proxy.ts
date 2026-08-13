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

export async function proxy(request: NextRequest) {
  const isAgencyPath = request.nextUrl.pathname.startsWith("/agency");
  const requiredScope = isAgencyPath ? "TENANT" : "PLATFORM";
  const loginPath = isAgencyPath ? "/agency-login" : "/login";
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
  matcher: ["/admin/:path*", "/agency/:path*"],
};
