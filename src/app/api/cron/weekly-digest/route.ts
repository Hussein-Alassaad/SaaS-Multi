import { NextRequest, NextResponse } from "next/server";
import { sendWeeklyDigestsAction } from "@/lib/actions/outreach-digest";
import { safeCompare } from "@/lib/safe-compare";

/**
 * Emails every active Outreach tenant's owner a 7-day sends/replies summary.
 * Meant to run once weekly (e.g. Monday morning) -- point an external
 * scheduler at this URL, same as /api/cron/dispatch-pacing. Protected by
 * CRON_SECRET so it can't be triggered by anyone who finds the URL.
 */
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

  const result = await sendWeeklyDigestsAction();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
