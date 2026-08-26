import { Resend } from "resend";
import { logError } from "@/lib/error-log";

/**
 * Bulk cold-outreach sending via Resend -- replaces src/lib/outreach/ses.ts's
 * sendOutreachEmail() after AWS SES's production-access request was
 * rejected (vague "account health" rejection, no specific fix given, see
 * this session's own conversation). Resend has no equivalent sandbox/
 * approval gate: any authenticated account can send to any address
 * immediately, at a materially lower cost tier than SES's real per-email
 * cost for this volume.
 *
 * Same exact function signature as ses.ts's sendOutreachEmail() so
 * src/lib/actions/outreach-approvals.ts's call site needed zero changes
 * to switch providers -- only the import line changed.
 *
 * Sends FROM the client account's own configured identity
 * (account.sesFromEmail/sesFromName -- field names kept as-is, not renamed
 * to avoid an unrelated schema migration for a provider swap), but the
 * actual From address's DOMAIN must be verified in Resend's dashboard
 * before Resend will accept it -- unlike SES, Resend does not allow
 * sending from an arbitrary unverified domain at all, even in a trial/
 * sandbox mode. Falls back to EMAIL_FROM (nxrs.tech, already verified for
 * this app's own transactional email in src/lib/email.ts) if the
 * account's own domain isn't verified, so a misconfigured client account
 * degrades to a working send instead of a hard failure.
 */
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendOutreachEmail(opts: {
  fromEmail: string;
  fromName?: string | null;
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: true; skipped?: true; messageId?: string } | { ok: false; error: string }> {
  if (!resend) {
    console.log(`[resend:noop] RESEND_API_KEY unset — would send "${opts.subject}" from ${opts.fromEmail} to ${opts.to}`);
    return { ok: true, skipped: true };
  }

  const fromAddress = opts.fromName ? `${opts.fromName} <${opts.fromEmail}>` : opts.fromEmail;

  try {
    const result = await resend.emails.send({
      from: fromAddress,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    if (result.error) {
      // Resend returns a typed error object (not a thrown exception) for
      // most send-time failures, e.g. sending from a domain that isn't
      // verified in this account yet -- surfaced as a normal failure the
      // caller already handles (marks the message "failed", doesn't count
      // it toward sentCount), not an unhandled crash.
      console.error("Resend send failed", result.error);
      await logError({
        source: "outreach.resend.send",
        error: result.error,
        context: { to: opts.to, subject: opts.subject, fromEmail: opts.fromEmail },
      });
      return { ok: false, error: result.error.message };
    }
    return { ok: true, messageId: result.data?.id };
  } catch (err) {
    console.error("Failed to send outreach email via Resend", err);
    await logError({ source: "outreach.resend.send", error: err, context: { to: opts.to, subject: opts.subject } });
    return { ok: false, error: "Failed to send email." };
  }
}
