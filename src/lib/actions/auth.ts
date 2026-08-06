"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSessionToken, setSessionCookie, clearSessionCookie, verifyPassword } from "@/lib/auth";

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

export async function logoutAction() {
  await clearSessionCookie();
  redirect("/login");
}
