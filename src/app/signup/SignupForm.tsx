"use client";

import { useActionState, useState } from "react";
import { signupAction, type SignupState } from "@/lib/actions/signup";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

const initialState: SignupState = {};

interface PlanOption {
  id: string;
  name: string;
  slug: string;
  monthlyPrice: number;
  yearlyPrice: number;
}

export function SignupForm({ plans }: { plans: PlanOption[] }) {
  const [state, formAction, pending] = useActionState(signupAction, initialState);
  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="companyName" className="text-xs font-medium text-[var(--text-3)]">
          Company name
        </label>
        <Input id="companyName" name="companyName" placeholder="Acme Agency" required />
        {state?.fieldErrors?.companyName && (
          <p className="text-xs text-[var(--status-hot)]">{state.fieldErrors.companyName}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="subdomain" className="text-xs font-medium text-[var(--text-3)]">
          Workspace URL
        </label>
        <div className="flex items-center">
          <Input id="subdomain" name="subdomain" placeholder="acme" required className="rounded-e-none" />
          <span className="flex h-9 items-center rounded-e-lg border border-s-0 border-[var(--border-hairline-strong)] bg-[var(--surface-2)] px-3 text-xs text-[var(--text-4)]">
            .nexaris.app
          </span>
        </div>
        {state?.fieldErrors?.subdomain && (
          <p className="text-xs text-[var(--status-hot)]">{state.fieldErrors.subdomain}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ownerName" className="text-xs font-medium text-[var(--text-3)]">
          Your name
        </label>
        <Input id="ownerName" name="ownerName" placeholder="Jane Doe" required />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-xs font-medium text-[var(--text-3)]">
          Email
        </label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@youragency.example.com" required />
        {state?.fieldErrors?.email && <p className="text-xs text-[var(--status-hot)]">{state.fieldErrors.email}</p>}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-xs font-medium text-[var(--text-3)]">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
        />
        {state?.fieldErrors?.password && (
          <p className="text-xs text-[var(--status-hot)]">{state.fieldErrors.password}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-medium text-[var(--text-3)]">Plan</span>
        <div className="grid grid-cols-1 gap-2">
          {plans.map((plan) => {
            const price = billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice;
            return (
              <label
                key={plan.id}
                className={cn(
                  "flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors",
                  planId === plan.id
                    ? "border-[var(--accent-from)] bg-[var(--surface-2)]"
                    : "border-[var(--border-hairline)] hover:bg-[var(--surface-2)]/60"
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="planId"
                    value={plan.id}
                    checked={planId === plan.id}
                    onChange={() => setPlanId(plan.id)}
                    className="accent-[var(--accent-from)]"
                  />
                  <span className="text-[var(--text-1)]">{plan.name}</span>
                </span>
                <span className="text-[var(--text-4)]">
                  ${(price / 100).toFixed(0)}/{billingCycle === "yearly" ? "yr" : "mo"}
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setBillingCycle("monthly")}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px]",
              billingCycle === "monthly" ? "bg-[var(--surface-2)] text-[var(--text-1)]" : "text-[var(--text-5)]"
            )}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBillingCycle("yearly")}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px]",
              billingCycle === "yearly" ? "bg-[var(--surface-2)] text-[var(--text-1)]" : "text-[var(--text-5)]"
            )}
          >
            Yearly (save ~15%)
          </button>
        </div>
        <input type="hidden" name="billingCycle" value={billingCycle} />
        {state?.fieldErrors?.planId && <p className="text-xs text-[var(--status-hot)]">{state.fieldErrors.planId}</p>}
      </div>

      {state?.error && (
        <p className="rounded-lg border border-[color-mix(in_oklab,var(--status-hot)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-hot)_12%,transparent)] px-3 py-2 text-xs text-[var(--status-hot)]">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
