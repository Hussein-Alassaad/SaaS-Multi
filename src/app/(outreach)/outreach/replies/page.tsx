import { getTenantSession } from "@/lib/auth";
import { getReplyThreadsAction } from "@/lib/actions/outreach-replies";
import { RepliesClient } from "./RepliesClient";

export default async function OutreachRepliesPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const result = await getReplyThreadsAction();
  const replied = result.ok ? result.replied : [];
  const notReplied = result.ok ? result.notReplied : [];

  return <RepliesClient tenantId={tenantId} initialReplied={replied} initialNotReplied={notReplied} />;
}
