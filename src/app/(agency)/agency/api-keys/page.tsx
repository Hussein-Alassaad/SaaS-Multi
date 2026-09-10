import { getTenantSession } from "@/lib/auth";
import { listApiKeysAction } from "@/lib/actions/marketing-api-keys";
import { ApiKeysClient } from "./ApiKeysClient";

export default async function ApiKeysPage() {
  await getTenantSession();
  const result = await listApiKeysAction();

  return <ApiKeysClient initialKeys={result.ok ? result.keys : []} />;
}
