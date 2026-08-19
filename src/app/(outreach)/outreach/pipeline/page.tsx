import { getTenantSession } from "@/lib/auth";
import { getPipelineBoard } from "@/lib/outreach/leads";
import { PipelineClient } from "./PipelineClient";

export default async function OutreachPipelinePage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const { leadsByStage, counts } = await getPipelineBoard(tenantId);

  return <PipelineClient leadsByStage={leadsByStage} counts={counts} />;
}
