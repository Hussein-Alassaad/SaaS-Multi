"use client";

import { useActionState } from "react";
import { loginAnyAction, type LoginState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const initialState: LoginState = {};

/**
 * Shared by /login, /agency-login, and /outreach-login -- one form, one
 * action (loginAnyAction), works for any account regardless of which page
 * it's submitted from. See loginAnyAction's own comment for why: emails
 * are globally unique, so there's no ambiguity in looking up by email
 * alone and redirecting wherever that account actually belongs.
 */
export function UnifiedLoginForm() {
  const [state, formAction, pending] = useActionState(loginAnyAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-xs font-medium text-[var(--text-3)]">
          Email
        </label>
        <Input id="email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-xs font-medium text-[var(--text-3)]">
            Password
          </label>
          <a href="/forgot-password" className="text-xs text-[var(--accent-from)] hover:underline">
            Forgot password?
          </a>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </div>

      {state?.error && (
        <p className="rounded-lg border border-[color-mix(in_oklab,var(--status-hot)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-hot)_12%,transparent)] px-3 py-2 text-xs text-[var(--status-hot)]">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
