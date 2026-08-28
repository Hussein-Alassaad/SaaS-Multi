import { withPlatformAccess } from "@/lib/db";

/**
 * Records a failure that would otherwise only exist in server console
 * output (AI reply generation, email sending, payment review, etc.) so
 * it's visible on /admin/error-logs instead of silently disappearing.
 * Never throws -- a logging failure must not mask the original error.
 */
export async function logError(opts: {
  source: string;
  error: unknown;
  tenantId?: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const message = opts.error instanceof Error ? opts.error.message : String(opts.error);
    const stack = opts.error instanceof Error ? opts.error.stack : undefined;
    // Platform-scoped rather than withTenant(opts.tenantId) on purpose:
    // logError() is called from tenant paths AND from platform-level ones
    // that have no tenantId at all (cron routes, signup, webhook handlers),
    // and it must never throw -- an RLS denial here would swallow the real
    // error it was called to record. The row still carries opts.tenantId,
    // so /admin/error-logs and the tenant-scoped Outreach errors view
    // (outreach-errors.ts, which reads these back under withTenant) both
    // filter correctly.
    await withPlatformAccess((tx) =>
      tx.errorLog.create({
        data: {
          source: opts.source,
          message,
          stack,
          tenantId: opts.tenantId,
          context: opts.context ? JSON.stringify(opts.context) : undefined,
        },
      })
    );
  } catch (loggingErr) {
    console.error("Failed to write ErrorLog row", loggingErr);
  }
}
