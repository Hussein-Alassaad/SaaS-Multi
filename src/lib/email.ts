import { Resend } from "resend";
import { logError } from "@/lib/error-log";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Sends a transactional email via Resend. No-ops (logs instead of sending)
 * when RESEND_API_KEY is unset, so signup/password-reset/team-invite flows
 * still complete end to end in development or before a Resend account is
 * connected — callers should never branch on whether email actually sent.
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true; skipped?: true } | { ok: false; error: string }> {
  if (!resend) {
    console.log(`[email:noop] RESEND_API_KEY unset — would send "${opts.subject}" to ${opts.to}`);
    return { ok: true, skipped: true };
  }

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "Nexaris <onboarding@resend.dev>",
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return { ok: true };
  } catch (err) {
    console.error("Failed to send email", err);
    await logError({ source: "email.send", error: err, context: { to: opts.to, subject: opts.subject } });
    return { ok: false, error: "Failed to send email." };
  }
}
