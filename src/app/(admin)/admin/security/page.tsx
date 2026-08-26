import { cookies } from "next/headers";
import { getSecurityPolicy, getActiveSessionsAction, getApiKeysAction, getIpAllowlistAction } from "@/lib/actions/security";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { SecurityClient } from "./SecurityClient";

export default async function SecurityPage() {
  // Read directly rather than via getSession() (which returns a plain User
  // row, not the JWT payload) -- only this page needs the raw sessionId,
  // purely to highlight "This device" in the Active Sessions list below.
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const payload = token ? await verifySessionToken(token) : null;
  const currentSessionId = payload?.sessionId ?? null;

  const [policy, sessionsResult, keysResult, allowlistResult] = await Promise.all([
    getSecurityPolicy(),
    getActiveSessionsAction(),
    getApiKeysAction(),
    getIpAllowlistAction(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Security</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          MFA policy, active sessions, API keys, and network access controls.
        </p>
      </div>

      <SecurityClient
        initialPolicy={{ mfaRequired: policy.mfaRequired, ssoEnforced: policy.ssoEnforced }}
        initialSessions={sessionsResult.ok ? sessionsResult.sessions : []}
        initialApiKeys={keysResult.ok ? keysResult.keys : []}
        initialAllowlist={allowlistResult.ok ? allowlistResult.entries : []}
        currentSessionId={currentSessionId}
      />
    </div>
  );
}
