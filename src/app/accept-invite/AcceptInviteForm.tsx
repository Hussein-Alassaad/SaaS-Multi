"use client";

import { useActionState } from "react";
import { acceptInviteAction, type AcceptInviteState } from "@/lib/actions/accept-invite";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const initialState: AcceptInviteState = {};

export function AcceptInviteForm({ inviteId }: { inviteId: string }) {
  const [state, formAction, pending] = useActionState(acceptInviteAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="inviteId" value={inviteId} />

      <div className="space-y-1.5">
        <label htmlFor="name" className="text-xs font-medium text-[var(--text-3)]">
          Your name
        </label>
        <Input id="name" name="name" placeholder="Jane Doe" required />
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
      </div>

      {state?.error && (
        <p className="rounded-lg border border-[color-mix(in_oklab,var(--status-hot)_45%,transparent)] bg-[color-mix(in_oklab,var(--status-hot)_12%,transparent)] px-3 py-2 text-xs text-[var(--status-hot)]">
          {state.error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Joining…" : "Join workspace"}
      </Button>
    </form>
  );
}
