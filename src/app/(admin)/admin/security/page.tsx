import { SecurityClient } from "./SecurityClient";

export default function SecurityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Security</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          MFA policy, active sessions, API keys, and network access controls.
        </p>
      </div>

      <SecurityClient />
    </div>
  );
}
