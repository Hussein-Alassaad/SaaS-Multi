"use client";

import { useActionState } from "react";
import { submitPaymentProofAction, type SignupState } from "@/lib/actions/signup";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const initialState: SignupState = {};

export function PaymentProofForm() {
  const [state, formAction, pending] = useActionState(submitPaymentProofAction, initialState);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="proofReference" className="text-xs font-medium text-[var(--text-3)]">
          Transaction reference
        </label>
        <Input id="proofReference" name="proofReference" placeholder="e.g. OMT-2026-000123" required />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="proofNote" className="text-xs font-medium text-[var(--text-3)]">
          Note (optional)
        </label>
        <Input id="proofNote" name="proofNote" placeholder="Sender name or phone number" />
      </div>

      {state?.error && (
        <p className="rounded-lg border border-[color-mix(in_oklab,var(--status-hot)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-hot)_12%,transparent)] px-3 py-2 text-xs text-[var(--status-hot)]">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Submitting…" : "Submit for review"}
      </Button>
    </form>
  );
}
