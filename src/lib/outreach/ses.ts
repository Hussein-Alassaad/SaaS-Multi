import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { logError } from "@/lib/error-log";

/**
 * Bulk cold-outreach sending via Amazon SES -- distinct from src/lib/email.ts
 * (Resend), which handles this app's own transactional email (password
 * resets, invites). SES is used here because Outreach sends at real cold-
 * email volume (300/day/account) where Resend's transactional-tier pricing
 * and deliverability posture aren't the right fit; the client specifically
 * requested SES.
 *
 * No-ops (logs instead of sending) when AWS credentials/region are unset,
 * matching src/lib/email.ts's pattern -- callers should never branch on
 * whether a send actually went out.
 */
const client =
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? new SESv2Client({
        region: process.env.AWS_REGION ?? "us-east-1",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      })
    : null;

export async function sendOutreachEmail(opts: {
  fromEmail: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true; skipped?: true; messageId?: string } | { ok: false; error: string }> {
  if (!client) {
    console.log(`[ses:noop] AWS credentials unset — would send "${opts.subject}" from ${opts.fromEmail} to ${opts.to}`);
    return { ok: true, skipped: true };
  }

  const fromAddress = opts.fromName ? `${opts.fromName} <${opts.fromEmail}>` : opts.fromEmail;

  try {
    const result = await client.send(
      new SendEmailCommand({
        FromEmailAddress: fromAddress,
        Destination: { ToAddresses: [opts.to] },
        Content: {
          Simple: {
            Subject: { Data: opts.subject, Charset: "UTF-8" },
            Body: { Html: { Data: opts.html, Charset: "UTF-8" } },
          },
        },
      })
    );
    return { ok: true, messageId: result.MessageId };
  } catch (err) {
    console.error("Failed to send outreach email via SES", err);
    await logError({ source: "outreach.ses.send", error: err, context: { to: opts.to, subject: opts.subject } });
    return { ok: false, error: "Failed to send email." };
  }
}
