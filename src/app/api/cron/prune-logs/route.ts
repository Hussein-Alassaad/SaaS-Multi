import { NextRequest, NextResponse } from "next/server";
import { withPlatformAccess } from "@/lib/db";
import { safeCompare } from "@/lib/safe-compare";

/**
 * Deletes old rows from tables the 2026-09-09 platform review found had no
 * retention/pruning logic anywhere -- both grow forever otherwise, since
 * every discovery/analysis/message-generation/sending cycle inserts an
 * OutreachRun row (some jobs fire every few minutes) and every failure
 * anywhere in the app inserts an ErrorLog row. Meant to run once daily,
 * same posture as /api/cron/dispatch-pacing -- point an external scheduler
 * at this URL, protected by the same CRON_SECRET.
 *
 * Retention windows: ErrorLog kept 90 days (debugging history worth
 * keeping a while); OutreachRun kept 30 days (pure operational run
 * history -- nothing in the product reads a run older than the current
 * day's for pacing/status decisions, see outreach/agent/db/repositories.py).
 */
const ERROR_LOG_RETENTION_DAYS = 90;
const OUTREACH_RUN_RETENTION_DAYS = 30;

// Same fix as /api/cron/dispatch-pacing (2026-09-16): Vercel Cron Jobs
// invoke this path with GET, not POST -- a GET-only route returns 405
// before any of this code runs, so this cron has been silently failing
// every scheduled fire. POST kept for manual authenticated triggers.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (!safeCompare(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const errorLogCutoff = new Date(now - ERROR_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const outreachRunCutoff = new Date(now - OUTREACH_RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const [errorLogs, outreachRuns] = await withPlatformAccess(async (tx) => {
    const errorLogs = await tx.errorLog.deleteMany({ where: { createdAt: { lt: errorLogCutoff } } });
    const outreachRuns = await tx.outreachRun.deleteMany({ where: { startedAt: { lt: outreachRunCutoff } } });
    return [errorLogs, outreachRuns];
  });

  return NextResponse.json({
    ok: true,
    deleted: { errorLogs: errorLogs.count, outreachRuns: outreachRuns.count },
  });
}

export const GET = handle;
export const POST = handle;
