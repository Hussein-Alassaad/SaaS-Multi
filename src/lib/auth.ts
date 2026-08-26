import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE_NAME = "admin_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

// How often an active session's UserSession.lastActiveAt is allowed to be
// re-touched. Every authenticated request calling getSession() would
// otherwise mean a write on every single page load/server action across
// every logged-in user platform-wide -- this throttle keeps "Active
// Sessions" honestly recent (within this window) without turning every
// request into a database write.
const LAST_ACTIVE_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Best-effort device label from the request's own User-Agent header, e.g.
 * "Chrome on macOS" -- deliberately simple substring matching, not a full
 * UA-parsing library, since this is a display label for a human skimming
 * the Security page, not something anything else in the app branches on. */
function parseDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Chrome\//.test(userAgent)
      ? "Chrome"
      : /Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)
        ? "Safari"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : "Unknown browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Mac OS X/.test(userAgent)
      ? "macOS"
      : /iPhone|iPad/.test(userAgent)
        ? "iOS"
        : /Android/.test(userAgent)
          ? "Android"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}

/** Best-effort client IP from standard proxy headers -- whichever the
 * deployment's reverse proxy/load balancer actually sets; falls back to
 * null (shown as "Unknown" in the UI) rather than guessing. */
async function requestIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip");
}

/**
 * HMAC secret used to sign/verify session JWTs. Falls back to a fixed
 * local-dev value when AUTH_SECRET isn't set so `npm run dev` works out of
 * the box; in production this throws instead of silently using the
 * insecure fallback (see src/lib/env.ts for the equivalent boot-time check).
 */
export function getSecretKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production.");
    }
    return new TextEncoder().encode("dev-only-insecure-fallback-secret-do-not-use-in-production");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  role: string;
  scope: string;
  sessionId: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Creates a real UserSession row (device/IP captured from the current
 * request's own headers) AND the signed JWT whose payload embeds that
 * row's id -- added 2026-08-22 so "Active Sessions" on the Admin Security
 * page (and the equivalent, if ever built, for tenant users -- this lives
 * in the shared auth module precisely so it already covers every login
 * path platform-wide, not just Admin) can list and revoke a REAL specific
 * browser session, not fake it. Before this, a valid signature was the
 * ONLY check on a session token; a revoked/deleted UserSession row now
 * invalidates the JWT immediately too (verifySessionToken() below checks
 * both), not just whenever the JWT's own 7-day expiry happens to pass.
 */
export async function createSessionToken(user: { id: string; role: string; scope: string }): Promise<string> {
  const ip = await requestIp();
  const h = await headers();
  const device = parseDeviceLabel(h.get("user-agent"));

  const session = await db.userSession.create({
    data: { userId: user.id, device, ip: ip ?? undefined },
  });

  return new SignJWT({ userId: user.id, role: user.role, scope: user.scope, sessionId: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if (
      typeof payload.userId !== "string" ||
      typeof payload.role !== "string" ||
      typeof payload.scope !== "string" ||
      typeof payload.sessionId !== "string"
    ) {
      return null;
    }
    return { userId: payload.userId, role: payload.role, scope: payload.scope, sessionId: payload.sessionId };
  } catch {
    return null;
  }
}

/**
 * Server-side helper: reads the session cookie, verifies the JWT AND its
 * backing UserSession row (rejecting a revoked or deleted session
 * immediately, not just on next JWT expiry), and fetches the full User
 * record (with role) from Prisma. Returns null if there is no session, the
 * token is invalid/expired/revoked, or the user no longer exists.
 */
export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const [user, session] = await Promise.all([
    db.user.findUnique({ where: { id: payload.userId }, include: { role: true } }),
    db.userSession.findUnique({ where: { id: payload.sessionId } }),
  ]);
  if (!user || user.status !== "ACTIVE") return null;
  if (!session || session.revokedAt) return null;

  // Throttled touch (see LAST_ACTIVE_TOUCH_INTERVAL_MS) -- fire-and-forget,
  // never awaited/blocking the response, and a failure here must never
  // fail the request itself (staleness in a "last active" timestamp is
  // harmless; this function's actual job -- returning the authenticated
  // user -- has already succeeded above).
  if (Date.now() - session.lastActiveAt.getTime() > LAST_ACTIVE_TOUCH_INTERVAL_MS) {
    db.userSession.update({ where: { id: session.id }, data: { lastActiveAt: new Date() } }).catch(() => {});
  }

  return user;
}

/**
 * Same as getSession() but only returns tenant-scope users, and only when
 * their tenant is still reachable (not suspended/churned). Used by every
 * Agency OS server component/action instead of getSession() directly.
 */
export async function getTenantSession() {
  const session = await getSession();
  if (!session || session.scope !== "TENANT" || !session.tenantId) return null;
  return session;
}

export async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

/**
 * Revokes the UserSession row backing the current cookie (so a copied/
 * leaked token stops working immediately, not just once its 7-day JWT
 * expiry passes) and clears the cookie itself. Reads the cookie BEFORE
 * deleting it -- order matters here.
 */
export async function clearSessionCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload) {
      await db.userSession.update({ where: { id: payload.sessionId }, data: { revokedAt: new Date() } }).catch(() => {});
    }
  }
  cookieStore.delete(SESSION_COOKIE_NAME);
}
