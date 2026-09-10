"use server";

import { redirect } from "next/navigation";
import { db, withTenant } from "@/lib/db";
import {
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  verifyPassword,
  getSession,
  requestIp,
} from "@/lib/auth";
import { PRODUCT_DASHBOARD_PATH, PRODUCT_LOGIN_PATH } from "@/lib/sections";
import { rateLimit, getRequestIp } from "@/lib/rate-limit";
import { ipMatchesAnyCidr } from "@/lib/ip-allowlist";

export interface LoginState {
  error?: string;
}

/**
 * Single entry point for every login page (Admin, Agency, Outreach) --
 * looks up the account by email ALONE (no scope filter), regardless of
 * which page the form was submitted from, then redirects to wherever that
 * account actually belongs. email is globally @unique on User, so this is
 * unambiguous. Fixes a real client-facing confusion: previously each login
 * page only matched its own scope, so a client with accounts on two
 * different products (e.g. MJivity has both an Outreach and an Agency
 * account, different emails) had to remember which specific URL matched
 * which account -- one wrong link looked identical to a wrong password.
 * Now any of the three login pages accepts any valid account and routes
 * correctly, so one link can be given to everyone.
 */
export async function loginAnyAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  // Unlike signup/password-reset (already rate-limited elsewhere in this
  // codebase), this was the one universal login entry point -- Admin,
  // Agency, and Outreach all funnel through it -- with NO rate limiting at
  // all, found in a 2026-09-09 review. Limited by IP AND by the submitted
  // email, not just one or the other: IP alone lets an attacker spread
  // guesses across many known emails from one IP without ever being
  // slowed down per-target; email alone lets a botnet spread the same
  // attack across many IPs. Both together closes both gaps. Checked
  // BEFORE the real DB lookup/password verify, so a lockout doesn't even
  // cost a bcrypt compare.
  const ip = await getRequestIp();
  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit(`login-ip:${ip}`, 20, 60_000),
    rateLimit(`login-email:${email}`, 5, 60_000),
  ]);
  if (!ipLimit.ok || !emailLimit.ok) {
    return { error: "Too many login attempts. Please try again in a minute." };
  }

  const user = await db.user.findFirst({
    where: { email },
    include: { role: true, tenant: { include: { product: true } } },
  });

  if (!user || !user.passwordHash) {
    return { error: "Invalid email or password." };
  }

  if (user.status !== "ACTIVE") {
    return { error: "This account is not active. Contact an administrator." };
  }

  if (user.scope === "TENANT" && (!user.tenant || user.tenant.status === "SUSPENDED" || user.tenant.status === "CHURNED")) {
    return { error: "This workspace is not currently accessible. Contact support." };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { error: "Invalid email or password." };
  }

  // Tenant IP allowlist (Marketing -> Security page only -- Outreach has no
  // equivalent feature and isn't touched here). Fails OPEN: an empty
  // allowlist means no restriction, same posture as the platform-wide
  // allowlist in src/middleware.ts.
  if (user.scope === "TENANT" && user.tenant?.product.slug === "marketing") {
    const allowlist = await withTenant(user.tenant.id, (tx) =>
      tx.tenantIpAllowlistEntry.findMany({ where: { tenantId: user.tenant!.id }, select: { cidr: true } })
    );
    if (allowlist.length > 0) {
      const ip = await requestIp();
      if (!ipMatchesAnyCidr(ip, allowlist.map((e) => e.cidr))) {
        return { error: "Your network is not on this workspace's allowed IP list. Contact an administrator." };
      }
    }
  }

  const token = await createSessionToken({
    id: user.id,
    role: user.role?.name ?? "",
    scope: user.scope,
  });
  await setSessionCookie(token);

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  if (user.scope === "PLATFORM") {
    redirect("/admin");
  }
  redirect(PRODUCT_DASHBOARD_PATH[user.tenant!.product.slug] ?? "/agency");
}

export async function logoutAction() {
  const session = await getSession();
  let redirectTo = "/login";
  if (session?.scope === "TENANT") {
    redirectTo = "/agency-login";
    if (session.tenantId) {
      const tenant = await db.tenant.findUnique({
        where: { id: session.tenantId },
        include: { product: true },
      });
      if (tenant) redirectTo = PRODUCT_LOGIN_PATH[tenant.product.slug] ?? "/agency-login";
    }
  }
  await clearSessionCookie();
  redirect(redirectTo);
}
