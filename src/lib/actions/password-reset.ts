"use server";

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { rateLimit, getRequestIp } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { resetPasswordEmail } from "@/lib/email-templates";
import { passwordSchema } from "@/types/signup";
import { randomBytes } from "node:crypto";

export interface ForgotPasswordState {
  message?: string;
  error?: string;
}

export interface ResetPasswordState {
  error?: string;
  success?: boolean;
}

const GENERIC_SUCCESS = "If an account exists with that email, we've sent a password reset link.";

export async function requestPasswordResetAction(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const ip = await getRequestIp();
  const limit = await rateLimit(`reset-request:${ip}`, 3, 60_000);
  if (!limit.ok) {
    return { error: "Too many requests. Please try again in a minute." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Email is required." };

  // Always return the same generic message regardless of whether the email
  // exists, to prevent user enumeration via this endpoint.
  const user = await db.user.findUnique({ where: { email } });
  if (user && user.passwordHash) {
    const resetToken = randomBytes(32).toString("hex");
    const resetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiresAt },
    });

    const resetUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${resetToken}`;
    await sendEmail({ to: user.email, ...resetPasswordEmail(resetUrl) });
  }

  return { message: GENERIC_SUCCESS };
}

export async function resetPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!token) return { error: "Missing reset token." };

  const parsedPassword = passwordSchema.safeParse(password);
  if (!parsedPassword.success) {
    return { error: parsedPassword.error.issues[0]?.message ?? "Invalid password." };
  }

  const user = await db.user.findUnique({ where: { resetToken: token } });
  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
    return { error: "This reset link is invalid or has expired. Please request a new one." };
  }

  const passwordHash = await hashPassword(parsedPassword.data);

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash, resetToken: null, resetTokenExpiresAt: null },
  });

  await db.auditLog.create({
    data: {
      actorId: user.id,
      action: "user.password_reset",
      resource: "user",
      tenantId: user.tenantId,
      device: "Desktop",
      browser: "Password Reset",
    },
  });

  return { success: true };
}
