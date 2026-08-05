import { getPlans } from "@/lib/mock/billing";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCents } from "@/lib/utils";
import { Check, Plus } from "lucide-react";

export default async function SubscriptionsPage() {
  const plans = await getPlans();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">Subscriptions</h1>
          <p className="text-sm text-[var(--text-4)] mt-1">
            Plan builder — Basic, Pro, and Enterprise tiers available across every product.
          </p>
        </div>
        <Button>
          <Plus className="h-4 w-4" />
          New Plan
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {plans.map((plan, i) => (
          <Card key={plan.id} className={i === 1 ? "ring-1 ring-[color-mix(in_oklab,var(--accent-from)_40%,transparent)]" : ""}>
            <CardHeader>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  {i === 1 && <Badge variant="accent">Most Popular</Badge>}
                </div>
                <CardDescription>{plan.activeSubCount} active subscriptions</CardDescription>
              </div>
            </CardHeader>

            <div className="mb-4">
              <span className="text-3xl font-semibold text-gradient">{formatCents(plan.monthlyPrice)}</span>
              <span className="text-sm text-[var(--text-4)]">/mo</span>
              <div className="text-xs text-[var(--text-5)] mt-0.5">
                or {formatCents(plan.yearlyPrice)}/yr
              </div>
            </div>

            <div className="space-y-2 text-sm mb-4">
              <FeatureRow label={`${plan.maxUsers} team members`} />
              <FeatureRow label={`${(plan.storageLimitMb / 1024).toFixed(0)} GB storage`} />
              <FeatureRow label={`${plan.aiCredits.toLocaleString()} AI credits/mo`} />
              {plan.features.map((f) => (
                <FeatureRow key={f} label={f} />
              ))}
            </div>

            <Button variant="outline" className="w-full">
              Edit Plan
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function FeatureRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[var(--text-2)]">
      <Check className="h-3.5 w-3.5 shrink-0 text-[var(--accent-from)]" />
      {label}
    </div>
  );
}
