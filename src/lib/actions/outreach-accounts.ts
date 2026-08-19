"use server";

import { db } from "@/lib/db";
import { getTenantSession } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";
import { encryptSecret } from "@/lib/outreach/crypto";

/**
 * Draft shape submitted by AccountHealthClient's per-account edit form.
 * Platform-specific fields (igDailyLimit/linkedinDailyLimit/proxy* vs.
 * emailDailyLimit/sesFromEmail/sesFromName) are all optional here since the
 * client only ever fills in the subset relevant to that account's
 * `platform` -- this action just persists whichever fields are present.
 * `proxyPassword` is the plaintext the user just typed (if anything) --
 * never the stored ciphertext, and an empty/omitted value means "leave the
 * existing encrypted password untouched" (see crypto.ts / accounts.ts).
 */
export interface AccountDraftInput {
  runTime?: string; // "HH:MM"
  igDailyLimit?: number;
  linkedinDailyLimit?: number;
  emailDailyLimit?: number;
  proxyHost?: string;
  proxyPort?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  sesFromEmail?: string;
  sesFromName?: string;
}

export async function saveAccountDraftAction(accountId: string, draft: AccountDraftInput) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "edit");
  if (!permCheck.ok) return permCheck;

  const account = await db.outreachAccount.findFirst({ where: { id: accountId, tenantId: session.tenantId! } });
  if (!account) return { ok: false as const, error: "Account not found." };

  const data: Record<string, unknown> = {};

  if (draft.runTime) data.runTime = draft.runTime.length === 5 ? `${draft.runTime}:00` : draft.runTime;
  if (draft.igDailyLimit != null && !Number.isNaN(draft.igDailyLimit)) data.igDailyLimit = draft.igDailyLimit;
  if (draft.linkedinDailyLimit != null && !Number.isNaN(draft.linkedinDailyLimit))
    data.linkedinDailyLimit = draft.linkedinDailyLimit;
  if (draft.emailDailyLimit != null && !Number.isNaN(draft.emailDailyLimit)) data.emailDailyLimit = draft.emailDailyLimit;

  if (draft.proxyHost !== undefined) data.proxyHost = draft.proxyHost || null;
  if (draft.proxyPort !== undefined) data.proxyPort = draft.proxyPort || null;
  if (draft.proxyUsername !== undefined) data.proxyUsername = draft.proxyUsername || null;
  // Empty submit = leave the existing encrypted password untouched -- never
  // overwrite a real secret with empty just because the masked field is
  // shown blank by default (see AccountHealthClient's placeholder UX).
  if (draft.proxyPassword) data.proxyPasswordEnc = encryptSecret(draft.proxyPassword);

  if (draft.sesFromEmail !== undefined) data.sesFromEmail = draft.sesFromEmail || null;
  if (draft.sesFromName !== undefined) data.sesFromName = draft.sesFromName || null;

  await db.outreachAccount.update({ where: { id: accountId }, data });

  return { ok: true as const };
}

export async function toggleRedistributeAction(accountId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "edit");
  if (!permCheck.ok) return permCheck;

  const account = await db.outreachAccount.findFirst({ where: { id: accountId, tenantId: session.tenantId! } });
  if (!account) return { ok: false as const, error: "Account not found." };

  await db.outreachAccount.update({
    where: { id: accountId },
    data: { redistributeFlag: !account.redistributeFlag },
  });

  return { ok: true as const };
}

export async function resumeAccountAction(accountId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "edit");
  if (!permCheck.ok) return permCheck;

  const account = await db.outreachAccount.findFirst({ where: { id: accountId, tenantId: session.tenantId! } });
  if (!account) return { ok: false as const, error: "Account not found." };

  await db.outreachAccount.update({
    where: { id: accountId },
    data: { status: "active", warningType: null, warningReason: null, redistributeFlag: false },
  });

  return { ok: true as const };
}
