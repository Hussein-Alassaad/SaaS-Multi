"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { agencyGuardResult } from "@/lib/agency-permissions";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { smtpConfigSchema, type SmtpConfigInput } from "@/types/marketing-settings";
import { logError } from "@/lib/error-log";
import { revalidatePath } from "next/cache";

/** Returns the tenant's SMTP config WITHOUT the password -- never sent to the client. */
export async function getSmtpConfigAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "settings", "view");
  if (!permCheck.ok) return permCheck;

  const config = await withTenant(session.tenantId!, (tx) =>
    tx.smtpConfig.findUnique({ where: { tenantId: session.tenantId! } })
  );
  if (!config) return { ok: true as const, config: null };

  return {
    ok: true as const,
    config: {
      id: config.id,
      tenantId: config.tenantId,
      host: config.host,
      port: config.port,
      username: config.username,
      useTls: config.useTls,
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      lastTestedAt: config.lastTestedAt,
      lastTestOk: config.lastTestOk,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    },
  };
}

export async function updateSmtpConfigAction(input: SmtpConfigInput) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "settings", "edit");
  if (!permCheck.ok) return permCheck;

  const parsed = smtpConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { password, ...rest } = parsed.data;

  let passwordEncrypted: string;
  try {
    passwordEncrypted = encryptSecret(password);
  } catch (err) {
    await logError({ source: "marketing_smtp.encrypt", error: err, context: { tenantId: session.tenantId } });
    return { ok: false as const, error: "Server is not configured to store secrets right now." };
  }

  await withTenant(session.tenantId!, async (tx) => {
    await tx.smtpConfig.upsert({
      where: { tenantId: session.tenantId! },
      update: { ...rest, passwordEncrypted, lastTestedAt: null, lastTestOk: null },
      create: { tenantId: session.tenantId!, ...rest, passwordEncrypted },
    });

    await tx.auditLog.create({
      data: {
        actorId: session.id,
        action: "smtp_config.updated",
        resource: "settings",
        tenantId: session.tenantId,
        newValue: JSON.stringify(rest),
        device: "Desktop",
        browser: "Agency OS",
      },
    });
  });

  revalidatePath("/agency/settings");
  return { ok: true as const };
}

/**
 * Sends a real test email through the tenant's SAVED SMTP config to their
 * own account email, using nodemailer to perform a real SMTP handshake
 * (distinct from src/lib/email.ts's Resend-based transactional email, which
 * this app uses for its own emails regardless of any tenant's SMTP setup).
 */
export async function testSmtpConnectionAction() {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = agencyGuardResult(session.role?.name ?? "", "settings", "edit");
  if (!permCheck.ok) return permCheck;

  const config = await withTenant(session.tenantId!, (tx) =>
    tx.smtpConfig.findUnique({ where: { tenantId: session.tenantId! } })
  );
  if (!config) return { ok: false as const, error: "Save your SMTP settings before testing." };

  const password = decryptSecret(config.passwordEncrypted);
  if (password === null) {
    return { ok: false as const, error: "Stored SMTP password could not be read. Re-enter and save it, then try again." };
  }

  let ok = false;
  let error: string | undefined;
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.useTls && config.port === 465,
      requireTLS: config.useTls && config.port !== 465,
      auth: { user: config.username, pass: password },
    });
    await transporter.sendMail({
      from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
      to: session.email,
      subject: "Test email from your Marketing settings",
      html: "<p>This is a test email confirming your SMTP configuration works.</p>",
    });
    ok = true;
  } catch (err) {
    await logError({ source: "marketing_smtp.test", error: err, context: { tenantId: session.tenantId } });
    error = "Could not send a test email with these SMTP settings. Check host, port, and credentials.";
  }

  await withTenant(session.tenantId!, (tx) =>
    tx.smtpConfig.update({
      where: { tenantId: session.tenantId! },
      data: { lastTestedAt: new Date(), lastTestOk: ok },
    })
  );

  revalidatePath("/agency/settings");
  return ok ? { ok: true as const } : { ok: false as const, error: error! };
}
