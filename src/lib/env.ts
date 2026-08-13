/**
 * Boot-time environment validation. Imported once from src/lib/db.ts so it
 * runs on first DB access — fails fast in production instead of silently
 * running with an insecure fallback secret or a missing database.
 */
const isProd = process.env.NODE_ENV === "production";

if (isProd && !process.env.AUTH_SECRET) {
  throw new Error("AUTH_SECRET must be set in production. Refusing to start with the insecure dev fallback.");
}
if (isProd && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set.");
}
// RESEND_API_KEY is intentionally NOT required — src/lib/email.ts no-ops
// (logs instead of sending) when it's unset, so email-dependent flows
// (signup verification, password reset, team invites) still work end to
// end in development/demo environments without a Resend account.
