"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createPlanAction, updatePlanAction, type PlanInput } from "@/lib/actions/plans";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export interface EditablePlan {
  id: string;
  name: string;
  slug: string;
  maxUsers: number;
  storageLimitMb: number;
  aiCredits: number;
  monthlyPrice: number; // cents
  yearlyPrice: number; // cents
  features: string[];
  isActive: boolean;
}

const emptyForm: PlanInput = {
  name: "",
  slug: "",
  maxUsers: 5,
  storageLimitMb: 1024,
  aiCredits: 1000,
  monthlyPrice: 0,
  yearlyPrice: 0,
  features: [],
  isActive: true,
};

function formFromPlan(plan: EditablePlan | null): PlanInput {
  if (!plan) return emptyForm;
  return {
    name: plan.name,
    slug: plan.slug,
    maxUsers: plan.maxUsers,
    storageLimitMb: plan.storageLimitMb,
    aiCredits: plan.aiCredits,
    monthlyPrice: plan.monthlyPrice / 100,
    yearlyPrice: plan.yearlyPrice / 100,
    features: plan.features,
    isActive: plan.isActive,
  };
}

/**
 * Shared create/edit modal -- `plan` is null for "New Plan", set for "Edit
 * Plan". Prices are entered and displayed in whole dollars in this form,
 * converted to cents (Plan.monthlyPrice/yearlyPrice's real unit, see
 * prisma/schema.prisma) only at the create/updatePlanAction boundary --
 * keeps the form's own state in the units a human actually types, same as
 * every other dollar-amount input in this app.
 *
 * Form state is seeded straight from `plan` via useState's lazy
 * initializer, not a useEffect -- SubscriptionsClient.tsx remounts this
 * component (via a `key` tied to the plan being edited, or "new" for
 * create) whenever which plan is being edited changes, which is what
 * actually resets the form; an effect calling setState on prop change is
 * the anti-pattern React's own docs warn against for exactly this case.
 */
export function PlanModal({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  plan: EditablePlan | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<PlanInput>(() => formFromPlan(plan));
  const [slugTouched, setSlugTouched] = useState(!!plan);
  const [featuresText, setFeaturesText] = useState(() => plan?.features.join("\n") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setName(value: string) {
    setForm((f) => ({ ...f, name: value, slug: slugTouched ? f.slug : slugify(value) }));
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.slug.trim()) {
      setError("Name and slug are required.");
      return;
    }
    setError(null);

    const payload: PlanInput = {
      ...form,
      monthlyPrice: Math.round(form.monthlyPrice * 100),
      yearlyPrice: Math.round(form.yearlyPrice * 100),
      features: featuresText.split("\n").map((f) => f.trim()).filter(Boolean),
    };

    startTransition(async () => {
      const result = plan ? await updatePlanAction(plan.id, payload) : await createPlanAction(payload);
      if (!result.ok) {
        setError(result.error ?? "Failed to save plan.");
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={plan ? `Edit ${plan.name}` : "New Plan"}
      description={plan ? "Changes apply to new subscriptions and renewals immediately." : "Creates a new plan tier, available for tenant signup right away."}
    >
      <div className="space-y-3">
        <Input placeholder="Plan name (e.g. Pro)" value={form.name} onChange={(e) => setName(e.target.value)} />
        <Input
          placeholder="Slug (e.g. pro)"
          value={form.slug}
          onChange={(e) => {
            setSlugTouched(true);
            setForm((f) => ({ ...f, slug: e.target.value.toLowerCase() }));
          }}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            type="number"
            placeholder="Monthly price ($)"
            value={form.monthlyPrice}
            onChange={(e) => setForm((f) => ({ ...f, monthlyPrice: Number(e.target.value) }))}
          />
          <Input
            type="number"
            placeholder="Yearly price ($)"
            value={form.yearlyPrice}
            onChange={(e) => setForm((f) => ({ ...f, yearlyPrice: Number(e.target.value) }))}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Input
            type="number"
            placeholder="Max users"
            value={form.maxUsers}
            onChange={(e) => setForm((f) => ({ ...f, maxUsers: Number(e.target.value) }))}
          />
          <Input
            type="number"
            placeholder="Storage (MB)"
            value={form.storageLimitMb}
            onChange={(e) => setForm((f) => ({ ...f, storageLimitMb: Number(e.target.value) }))}
          />
          <Input
            type="number"
            placeholder="AI credits/mo"
            value={form.aiCredits}
            onChange={(e) => setForm((f) => ({ ...f, aiCredits: Number(e.target.value) }))}
          />
        </div>
        <textarea
          className="w-full rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-from)]"
          rows={4}
          placeholder="One feature per line"
          value={featuresText}
          onChange={(e) => setFeaturesText(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-[var(--text-3)]">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          Active (visible on signup)
        </label>
        {error && <p className="text-xs text-[var(--status-hot)]">{error}</p>}
        <Button className="w-full" disabled={pending} onClick={handleSubmit}>
          {pending ? "Saving..." : plan ? "Save changes" : "Create plan"}
        </Button>
      </div>
    </Modal>
  );
}
