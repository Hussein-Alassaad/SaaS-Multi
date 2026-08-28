"use server";

import { withTenant } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { encryptSecret } from "@/lib/outreach/crypto";

/**
 * Draft shape submitted by AccountHealthClient's per-account edit form.
 * Platform-specific fields (proxy* vs. sesFromEmail/sesFromName) are all
 * optional here since the client only ever fills in the subset relevant to
 * that account's `platform` -- this action just persists whichever fields
 * are present. `proxyPassword` is the plaintext the user just typed (if
 * anything) -- never the stored ciphertext, and an empty/omitted value
 * means "leave the existing encrypted password untouched" (see crypto.ts /
 * accounts.ts).
 *
 * igDailyLimit/linkedinDailyLimit/emailDailyLimit/sesFromEmail/sesFromName
 * are DELIBERATELY not accepted here -- those are Admin-only now (see
 * src/lib/actions/admin-tenants.ts's setOutreachDailyLimitAction() and
 * setOutreachSenderAction()), a tenant's own session can no longer raise
 * its own daily send/discovery caps or pick its own From address (the
 * address lives under the platform's own verified Resend domain, not the
 * tenant's). AccountHealthClient shows them as read-only display fields,
 * never sends them in a draft submission -- even if a request were
 * crafted by hand with these fields set, this action has no code path
 * that would write them, so the client-side lock isn't the only thing
 * enforcing this.
 */
export interface AccountDraftInput {
  runTime?: string; // "HH:MM"
  proxyHost?: string;
  proxyPort?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  loginEmail?: string;
  loginPassword?: string;
}

export async function saveAccountDraftAction(accountId: string, draft: AccountDraftInput) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "edit");
  if (!permCheck.ok) return permCheck;

  const account = await withTenant(session.tenantId!, (tx) =>
    tx.outreachAccount.findFirst({ where: { id: accountId, tenantId: session.tenantId! } })
  );
  if (!account) return { ok: false as const, error: "Account not found." };

  const data: Record<string, unknown> = {};

  if (draft.runTime) data.runTime = draft.runTime.length === 5 ? `${draft.runTime}:00` : draft.runTime;

  if (draft.proxyHost !== undefined) data.proxyHost = draft.proxyHost || null;
  if (draft.proxyPort !== undefined) data.proxyPort = draft.proxyPort || null;
  if (draft.proxyUsername !== undefined) data.proxyUsername = draft.proxyUsername || null;
  // Empty submit = leave the existing encrypted password untouched -- never
  // overwrite a real secret with empty just because the masked field is
  // shown blank by default (see AccountHealthClient's placeholder UX).
  if (draft.proxyPassword) data.proxyPasswordEnc = encryptSecret(draft.proxyPassword);

  // A deliberate proxy-host/port/username change means the tenant is
  // intentionally swapping this account onto a different proxy (e.g. the
  // old one lapsed, a genuine provider change) -- clear the recorded
  // verifiedProxyIp baseline so the Python agent's next run establishes a
  // FRESH baseline against the new proxy instead of comparing it to the
  // old one and refusing to proceed forever (see
  // outreach/agent/core/session.py's verify_proxy_ip()/ProxyIpMismatch).
  // Only clears on an actual value change, not merely re-submitting the
  // same host/port/username unchanged.
  const proxyIdentityChanged =
    (draft.proxyHost !== undefined && draft.proxyHost !== (account.proxyHost ?? "")) ||
    (draft.proxyPort !== undefined && draft.proxyPort !== (account.proxyPort ?? "")) ||
    (draft.proxyUsername !== undefined && draft.proxyUsername !== (account.proxyUsername ?? ""));
  if (proxyIdentityChanged) data.verifiedProxyIp = null;

  // Submitting new LinkedIn/Instagram login credentials re-arms the agent to
  // attempt a fresh unsupervised login on its next scheduled run -- status
  // flips to "pending_first_login" (not "connected" -- that only happens
  // once the Python agent's own login flow actually succeeds and reports
  // back, see outreach/agent/core/session.py's ensure_logged_in()) and any
  // stale error from a previous failed attempt is cleared, since a fresh
  // credential submission deserves a fresh attempt, not a stale error
  // banner sitting on top of it.
  if (draft.loginEmail !== undefined) data.loginEmail = draft.loginEmail || null;
  if (draft.loginPassword) {
    data.loginPasswordEnc = encryptSecret(draft.loginPassword);
    data.loginStatus = "pending_first_login";
    data.loginError = null;
  }

  await withTenant(session.tenantId!, (tx) =>
    tx.outreachAccount.updateMany({ where: { id: accountId, tenantId: session.tenantId! }, data })
  );

  return { ok: true as const };
}

export interface CreateAccountInput {
  label: string;
  platform: "linkedin" | "instagram" | "email";
}

/**
 * Tenant-side account creation -- the piece that was missing entirely before
 * this feature: AccountHealthClient could only edit accounts that already
 * existed (seeded, or created some other way outside this app). A client
 * adding their own LinkedIn/Instagram/email channel now starts here, then
 * fills in login/proxy/SES details via saveAccountDraftAction on the same
 * row this creates.
 */
export async function createOutreachAccountAction(input: CreateAccountInput) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "create");
  if (!permCheck.ok) return permCheck;

  const label = input.label.trim();
  if (!label) return { ok: false as const, error: "Account label is required." };
  if (!["linkedin", "instagram", "email"].includes(input.platform)) {
    return { ok: false as const, error: "Invalid platform." };
  }

  const account = await withTenant(session.tenantId!, (tx) =>
    tx.outreachAccount.create({
      data: { tenantId: session.tenantId!, label, platform: input.platform },
    })
  );

  return { ok: true as const, accountId: account.id };
}

export async function deleteOutreachAccountAction(accountId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "delete");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const account = await tx.outreachAccount.findFirst({ where: { id: accountId, tenantId: session.tenantId! } });
    if (!account) return false;
    await tx.outreachAccount.deleteMany({ where: { id: accountId, tenantId: session.tenantId! } });
    return true;
  });
  if (!found) return { ok: false as const, error: "Account not found." };

  return { ok: true as const };
}

export async function toggleRedistributeAction(accountId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const account = await tx.outreachAccount.findFirst({ where: { id: accountId, tenantId: session.tenantId! } });
    if (!account) return false;
    await tx.outreachAccount.updateMany({
      where: { id: accountId, tenantId: session.tenantId! },
      data: { redistributeFlag: !account.redistributeFlag },
    });
    return true;
  });
  if (!found) return { ok: false as const, error: "Account not found." };

  return { ok: true as const };
}

export async function resumeAccountAction(accountId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "edit");
  if (!permCheck.ok) return permCheck;

  const found = await withTenant(session.tenantId!, async (tx) => {
    const account = await tx.outreachAccount.findFirst({ where: { id: accountId, tenantId: session.tenantId! } });
    if (!account) return false;
    await tx.outreachAccount.updateMany({
      where: { id: accountId, tenantId: session.tenantId! },
      data: { status: "active", warningType: null, warningReason: null, redistributeFlag: false },
    });
    return true;
  });
  if (!found) return { ok: false as const, error: "Account not found." };

  return { ok: true as const };
}
