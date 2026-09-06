import { getTenantSession } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { getLiveFeed } from "@/lib/outreach/leads";
import { safeJsonParse } from "@/lib/utils";
import { LiveFeedClient } from "./LiveFeedClient";

export default async function OutreachLiveFeedPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const [{ items, nextCursor }, settings] = await Promise.all([
    getLiveFeed(tenantId),
    withTenant(tenantId, (tx) => tx.outreachSettings.findUnique({ where: { tenantId }, select: { paused: true } })),
  ]);

  const leads = items.map((lead) => ({
    id: lead.id,
    platform: lead.platform,
    businessName: lead.businessName,
    industry: lead.industry,
    score: lead.score,
    temperature: lead.temperature,
    founderFound: lead.founderFound,
    founderName: lead.founderName,
    weakPoints: safeJsonParse<string[]>(lead.weakPoints, []),
    generatedMessage: lead.generatedMessage,
  }));

  return (
    <LiveFeedClient
      tenantId={tenantId}
      initialLeads={leads}
      initialNextCursor={nextCursor}
      initialPaused={settings?.paused ?? false}
    />
  );
}
