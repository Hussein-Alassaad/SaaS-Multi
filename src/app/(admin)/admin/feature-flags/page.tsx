import { getFeatureFlagsMatrix } from "@/lib/mock/flags";
import { FeatureFlagsClient } from "./FeatureFlagsClient";

export default async function FeatureFlagsPage() {
  const flags = await getFeatureFlagsMatrix();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Feature Flags</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          Control rollout at global, product, tenant, or subscription-plan scope.
        </p>
      </div>

      <FeatureFlagsClient
        flags={flags.map((f) => ({
          id: f.id,
          key: f.key,
          name: f.name,
          description: f.description,
          scope: f.scope,
          scopeLabel: f.scopeLabel,
          enabled: f.enabled,
        }))}
      />
    </div>
  );
}
