"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { resetPasswordAction, type ResetPasswordState } from "@/lib/actions/password-reset";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const initialState: ResetPasswordState = {};

export function ResetPasswordForm({ token, loginPath }: { token: string; loginPath: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state?.success) {
      const timer = setTimeout(() => router.push(loginPath), 1500);
      return () => clearTimeout(timer);
    }
  }, [state?.success, loginPath, router]);

  if (state?.success) {
    return (
      <p className="rounded-lg border border-[var(--border-hairline)] bg-[var(--surface-2)] px-3 py-2.5 text-sm text-[var(--text-2)]">
        Password updated. Redirecting to sign in…
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-xs font-medium text-[var(--text-3)]">
          New password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
        />
      </div>

      {state?.error && (
        <p className="rounded-lg border border-[color-mix(in_oklab,var(--status-hot)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-hot)_12%,transparent)] px-3 py-2 text-xs text-[var(--status-hot)]">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
