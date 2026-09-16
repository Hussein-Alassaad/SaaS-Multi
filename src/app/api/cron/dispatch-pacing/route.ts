import { NextRequest, NextResponse } from "next/server";
import { dispatchPacingQueueAction } from "@/lib/actions/outreach-approvals";
import { safeCompare } from "@/lib/safe-compare";

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
// REAL BUG FOUND 2026-09-16: this route only exported POST, but Vercel Cron
// Jobs invoke the configured path with GET, attaching the CRON_SECRET
// bearer token itself. With no GET handler, Next.js's router returned a
// 405 before this file's own code (the secret check, dispatchPacingQueueAction)
// ever ran -- every scheduled 05:00 UTC run was silently rejected at the
// framework level since this route was written, which is why emails stuck
// at queued_for_pacing/approved+pending never actually got redispatched on
// their own. GET now handles the real Vercel Cron invocation; POST is kept
// so a manual authenticated trigger still works.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (!safeCompare(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await dispatchPacingQueueAction();
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
