import { db } from "@/lib/db";

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
    await db.errorLog.create({
      data: {
        source: opts.source,
        message,
        stack,
        tenantId: opts.tenantId,
        context: opts.context ? JSON.stringify(opts.context) : undefined,
      },
    });
  } catch (loggingErr) {
    console.error("Failed to write ErrorLog row", loggingErr);
  }
}
