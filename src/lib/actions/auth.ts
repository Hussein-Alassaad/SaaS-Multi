"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSessionToken, setSessionCookie, clearSessionCookie, verifyPassword, getSession } from "@/lib/auth";
import { PRODUCT_DASHBOARD_PATH, PRODUCT_LOGIN_PATH } from "@/lib/sections";

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
