"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSessionToken, setSessionCookie, clearSessionCookie, verifyPassword, getSession } from "@/lib/auth";
import { PRODUCT_DASHBOARD_PATH, PRODUCT_LOGIN_PATH } from "@/lib/sections";

export interface LoginState {
  error?: string;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const user = await db.user.findFirst({
    where: { email, scope: "PLATFORM" },
    include: { role: true },
  });

  if (!user || !user.passwordHash) {
    return { error: "Invalid email or password." };
  }

  if (user.status !== "ACTIVE") {
    return { error: "This account is not active. Contact an administrator." };
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

  redirect("/admin");
}

export async function loginTenantAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const user = await db.user.findFirst({
    where: { email, scope: "TENANT" },
    include: { role: true, tenant: { include: { product: true } } },
  });

  if (!user || !user.passwordHash) {
    return { error: "Invalid email or password." };
  }

  if (user.status !== "ACTIVE") {
    return { error: "This account is not active. Contact your agency admin." };
  }

  if (!user.tenant || user.tenant.status === "SUSPENDED" || user.tenant.status === "CHURNED") {
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

  redirect(PRODUCT_DASHBOARD_PATH[user.tenant.product.slug] ?? "/agency");
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
