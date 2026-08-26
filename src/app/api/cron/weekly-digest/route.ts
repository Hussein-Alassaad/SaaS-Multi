import { NextRequest, NextResponse } from "next/server";
import { sendWeeklyDigestsAction } from "@/lib/actions/outreach-digest";

/**
 * Emails every active Outreach tenant's owner a 7-day sends/replies summary.
 * Meant to run once weekly (e.g. Monday morning) -- point an external
 * scheduler at this URL, same as /api/cron/dispatch-pacing. Protected by
 * CRON_SECRET so it can't be triggered by anyone who finds the URL.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendWeeklyDigestsAction();
  return NextResponse.json(result);
}
