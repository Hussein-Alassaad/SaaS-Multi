import { cookies } from "next/headers";
import { getTenantSession, verifySessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { listTenantSessionsAction } from "@/lib/actions/agency-security";
import { listApiKeysAction } from "@/lib/actions/marketing-api-keys";
import { getTenantIpAllowlistAction } from "@/lib/actions/agency-security";
import { SecurityClient } from "./SecurityClient";

export default async function SecurityPage() {
  await getTenantSession();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const payload = token ? await verifySessionToken(token) : null;

  const [sessionsResult, keysResult, allowlistResult] = await Promise.all([
    listTenantSessionsAction(),
    listApiKeysAction(),
    getTenantIpAllowlistAction(),
  ]);

  return (
    <SecurityClient
      initialSessions={sessionsResult.ok ? sessionsResult.sessions : []}
      initialApiKeys={keysResult.ok ? keysResult.keys : []}
      initialAllowlist={allowlistResult.ok ? allowlistResult.entries : []}
      currentSessionId={payload?.sessionId ?? null}
    />
  );
}
