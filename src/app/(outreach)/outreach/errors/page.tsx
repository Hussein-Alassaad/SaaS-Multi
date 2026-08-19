import { getTenantSession } from "@/lib/auth";
import { getOutreachErrorsAction } from "@/lib/actions/outreach-errors";
import { ErrorsClient } from "./ErrorsClient";

export default async function OutreachErrorsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;

  const result = await getOutreachErrorsAction();
  const errors = result.ok ? result.errors : [];

  return <ErrorsClient tenantId={tenantId} initialErrors={errors} />;
}
