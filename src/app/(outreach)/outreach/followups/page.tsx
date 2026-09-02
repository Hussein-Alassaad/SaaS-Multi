import { getTenantSession } from "@/lib/auth";
import { getNotRepliedLeadsAction } from "@/lib/actions/outreach-followups";
import { FollowUpsClient } from "./FollowUpsClient";

export default async function OutreachFollowUpsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const result = await getNotRepliedLeadsAction();
  const leads = result.ok ? result.leads : [];

  return <FollowUpsClient tenantId={tenantId} initialLeads={leads} />;
}
