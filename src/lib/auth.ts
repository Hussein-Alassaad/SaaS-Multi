import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

export const SESSION_COOKIE_NAME = "admin_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * HMAC secret used to sign/verify session JWTs. Falls back to a fixed
 * local-dev value when AUTH_SECRET isn't set so `npm run dev` works out of
 * the box; any real deployment must set AUTH_SECRET (see .env.example).
 */
function getSecretKey() {
  const secret = process.env.AUTH_SECRET ?? "dev-only-insecure-fallback-secret-do-not-use-in-production";
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  role: string;
  scope: string;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(user: { id: string; role: string; scope: string }): Promise<string> {
  return new SignJWT({ userId: user.id, role: user.role, scope: user.scope })
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
      typeof payload.scope !== "string"
    ) {
      return null;
    }
    return { userId: payload.userId, role: payload.role, scope: payload.scope };
  } catch {
    return null;
  }
}

/**
 * Server-side helper: reads the session cookie, verifies it, and fetches
 * the full User record (with role) from Prisma. Returns null if there is
 * no session, the token is invalid/expired, or the user no longer exists.
 */
export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await db.user.findUnique({
    where: { id: payload.userId },
    include: { role: true },
  });
  if (!user || user.status !== "ACTIVE") return null;

  return user;
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

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
