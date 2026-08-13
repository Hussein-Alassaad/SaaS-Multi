"use client";

import { useActionState } from "react";
import { requestPasswordResetAction, type ForgotPasswordState } from "@/lib/actions/password-reset";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const initialState: ForgotPasswordState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(requestPasswordResetAction, initialState);

  if (state?.message) {
    return (
      <p className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text-2)]">
        {state.message}
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-xs font-medium text-[var(--text-3)]">
          Email
        </label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      </div>

      {state?.error && (
        <p className="rounded-lg border border-[color-mix(in_oklab,var(--status-hot)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-hot)_12%,transparent)] px-3 py-2 text-xs text-[var(--status-hot)]">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
