import { NextRequest, NextResponse } from "next/server";
import { dispatchPacingQueueAction } from "@/lib/actions/outreach-approvals";

/**
 * Redispatches every email stuck at "queued_for_pacing" (approved, but held
 * back because the sending account's daily cap was already hit at approval
 * time -- see src/lib/actions/outreach-approvals.ts's sendIfEmailChannel()).
 * Meant to run once daily, after UTC midnight, when every account's cap
 * resets -- point any scheduler at this URL (a simple OS cron job with curl,
 * a hosting platform's scheduled-function feature, etc.), since this repo
 * has no in-process job runner. Protected by CRON_SECRET so it can't be
 * triggered by anyone who finds the URL.
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

  const result = await dispatchPacingQueueAction();
  return NextResponse.json(result);
}
