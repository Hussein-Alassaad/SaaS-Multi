/**
 * Shared between src/lib/actions/outreach-approvals.ts (a "use server" file,
 * which can only export async server actions -- so this plain classifier
 * logic can't live there and be imported by a client/server component) and
 * src/app/(outreach)/outreach/approvals/page.tsx (which hand-serializes the
 * same OutreachMessage shape for the page's initial server-rendered load,
 * separately from getApprovalQueueAction's later client-side reloads).
 * Keeping the reason constants and the permanence classifier in one place
 * means both call sites stay in sync instead of drifting.
 */

// Fixed, recognizable email-failure reason strings outreach-approvals.ts
// itself writes (as opposed to LinkedIn/Instagram's sendFailureReason,
// which is free text raised by the Python agent).
export const EMAIL_FAILURE_DO_NOT_CONTACT = "This lead is marked Do Not Contact.";
export const EMAIL_FAILURE_NO_CONTACT_EMAIL = "This lead has no contact email on file.";
export const EMAIL_FAILURE_NO_ACCOUNT = "No email-sending account is configured for this tenant.";

// Resend error codes (Resend's own ErrorResponse.name -- see
// src/lib/outreach/resend-email.ts) that mean "this exact send will fail
// again identically no matter how many times it's retried" -- bad/missing
// input, auth/access problems, a rejected recipient. Left OUT deliberately:
// rate_limit_exceeded, monthly/daily_quota_exceeded, application_error,
// internal_server_error, concurrent_idempotent_requests -- all genuinely
// transient, exactly the case "Retry send" exists for.
const PERMANENT_RESEND_ERROR_CODES = new Set([
  "validation_error",
  "invalid_from_address",
  "invalid_access",
  "invalid_parameter",
  "invalid_region",
  "missing_required_field",
  "invalid_idempotency_key",
  "restricted_api_key",
  "invalid_api_key",
  "not_found",
  "method_not_allowed",
  "security_error",
]);

/**
 * Email-only permanence check. An email sendFailureReason is never nearly
 * as reliably "permanent" as LinkedIn's no-Message-button case -- most
 * Resend failures (rate limits, transient API errors, one-off network
 * blips) are exactly the kind of thing retrying should fix, so this only
 * flags the truly-permanent subset (a recognized Resend error code, or one
 * of outreach-approvals.ts's own fixed pre-send guard reasons) and defaults
 * to "transient, keep offering retry" for everything else, including any
 * reason string this function doesn't recognize -- hiding the retry button
 * is the worse failure mode of the two.
 */
export function isPermanentEmailFailureReason(reason: string | null): boolean {
  if (!reason) return false;
  if (reason === EMAIL_FAILURE_DO_NOT_CONTACT) return true;
  if (reason === EMAIL_FAILURE_NO_CONTACT_EMAIL) return true;
  if (reason === EMAIL_FAILURE_NO_ACCOUNT) return true;
  if (reason.startsWith("Account paused") || reason.startsWith("Email account is")) return true;
  const codeMatch = /^Resend error \(([a-z_]+)\):/.exec(reason);
  if (codeMatch && PERMANENT_RESEND_ERROR_CODES.has(codeMatch[1])) return true;
  return false;
}

/**
 * Whether a message's sendFailureReason should be treated as PERMANENT
 * (retry hidden, "Can't be reached" shown) for the given channel. LinkedIn/
 * Instagram only ever set a reason for the genuinely permanent
 * NoMessageButtonAvailable case, so any non-null reason there is permanent;
 * email needs the finer-grained check above since most email failures are
 * transient.
 */
export function sendFailureIsPermanent(channel: string, sendStatus: string, sendFailureReason: string | null): boolean {
  if (sendStatus !== "failed" || !sendFailureReason) return false;
  if (channel === "email") return isPermanentEmailFailureReason(sendFailureReason);
  return true;
}
