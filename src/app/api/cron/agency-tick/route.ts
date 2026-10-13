import { NextRequest, NextResponse } from "next/server";
import { safeCompare } from "@/lib/safe-compare";
import { logError } from "@/lib/error-log";
import { alertUnansweredCustomers, sendMeetingReminders } from "@/lib/agency/tick";

/**
 * Called every minute by the database (Supabase pg_cron + pg_net, see
 * prisma/manual/agency_tick_cron.sql) -- Vercel's own cron is daily on the
 * plans this project is likely on, which is too slow for "an hour before the
 * call" and "nobody answered for 10 minutes". Same CRON_SECRET bearer check
 * as the other /api/cron routes. GET and POST both accepted.
 */
export const maxDuration = 60;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (!safeCompare(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Independent: a failure in one must not stop the other.
  const [reminders, unanswered] = await Promise.all([
    sendMeetingReminders().catch(async (err) => {
      await logError({ source: "cron.agency_tick.reminders", error: err });
      return { sent: 0, skipped: 0, error: true };
    }),
    alertUnansweredCustomers().catch(async (err) => {
      await logError({ source: "cron.agency_tick.unanswered", error: err });
      return { alerted: 0, error: true };
    }),
  ]);
  return NextResponse.json({ ok: true, reminders, unanswered });
}

export { handle as GET, handle as POST };
