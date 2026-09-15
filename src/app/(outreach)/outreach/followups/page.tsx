import { getTenantSession } from "@/lib/auth";
import { getNotRepliedLeadsAction, getFollowUpGuidanceAction } from "@/lib/actions/outreach-followups";
import { FollowUpsClient } from "./FollowUpsClient";

export default async function OutreachFollowUpsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const [result, guidanceResult] = await Promise.all([
    getNotRepliedLeadsAction(),
    getFollowUpGuidanceAction(),
  ]);
  const leads = result.ok ? result.leads : [];
  const initialGuidance = guidanceResult.ok ? guidanceResult.guidance : "";

  return <FollowUpsClient tenantId={tenantId} initialLeads={leads} initialGuidance={initialGuidance} />;
}
