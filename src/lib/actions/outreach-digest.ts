"use server";

import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { weeklyDigestEmail, type WeeklyDigestPlatformRow } from "@/lib/email-templates";

/**
 * Sends every Outreach tenant a "here's what happened this week" email to
 * its owner, summarizing sends/replies per platform over the trailing 7
 * days. Meant to run once weekly via the /api/cron/weekly-digest route
 * (same CRON_SECRET-gated pattern as dispatch-pacing) -- there is no
 * in-process job runner in this repo, so an external scheduler must call
 * that route on a schedule. Skips tenants with zero activity in the window
 * (nothing worth reporting) and tenants with no owner email on file.
 */
export async function sendWeeklyDigestsAction() {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  const tenants = await db.tenant.findMany({
    where: { product: { slug: "outreach" }, status: "ACTIVE" },
    select: { id: true, companyName: true, subdomain: true, owner: { select: { email: true, name: true } } },
  });

  let sent = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    if (!tenant.owner?.email) {
      skipped++;
      continue;
    }

    const [messages, replies] = await Promise.all([
      db.outreachMessage.findMany({
        where: { tenantId: tenant.id, sendStatus: "sent", sentAt: { gte: weekStart } },
        select: { channel: true },
      }),
      db.outreachReply.findMany({
        where: { tenantId: tenant.id, repliedAt: { gte: weekStart } },
        select: { channel: true },
      }),
    ]);

    if (messages.length === 0) {
      skipped++;
      continue;
    }

    const byPlatform = new Map<string, WeeklyDigestPlatformRow>();
    const get = (platform: string) => {
      let row = byPlatform.get(platform);
      if (!row) {
        row = { platform, sent: 0, replied: 0 };
        byPlatform.set(platform, row);
      }
      return row;
    };
    for (const m of messages) get(m.channel).sent += 1;
    for (const r of replies) get(r.channel).replied += 1;

    const rows = Array.from(byPlatform.values()).sort((a, b) => b.sent - a.sent);
    const dashboardUrl = `${process.env.APP_URL ?? "http://localhost:3000"}/outreach/analytics`;
    const { subject, html } = weeklyDigestEmail(tenant.companyName, rows, dashboardUrl);

    const result = await sendEmail({ to: tenant.owner.email, subject, html });
    if (result.ok) sent++;
  }

  return { ok: true as const, sent, skipped, totalTenants: tenants.length };
}
