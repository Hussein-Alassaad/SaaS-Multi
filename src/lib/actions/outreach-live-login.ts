"use server";

import { SignJWT } from "jose";
import { db } from "@/lib/db";
import { getTenantSession, getSecretKey } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";

/**
 * Mints a short-lived (120s), single-purpose token scoped to exactly one
 * account, then hands the client the droplet's websocket URL to open
 * DIRECTLY -- this server action never touches the actual live browser
 * session/frame traffic, since a long-lived websocket connection can't
 * live inside a Vercel serverless function (see outreach/agent/live_login/
 * for where the real work happens, on the always-on droplet instead).
 *
 * This is deliberately NOT a full session token: no sessionId, no
 * UserSession row, verified by the droplet with signature+claims only
 * (see live_login/auth.py's verify_connect_token()). A leaked token's
 * blast radius is small and short-lived -- one account, 120 seconds.
 */
export async function startConnectAccountAction(accountId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "edit");
  if (!permCheck.ok) return permCheck;

  const wsHost = process.env.LIVE_LOGIN_WS_HOST;
  if (!wsHost) {
    return { ok: false as const, error: "Live login isn't configured on this deployment yet." };
  }

  const account = await db.outreachAccount.findFirst({
    where: { id: accountId, tenantId: session.tenantId! },
  });
  if (!account) return { ok: false as const, error: "Account not found." };
  if (account.platform !== "linkedin" && account.platform !== "instagram") {
    return { ok: false as const, error: "Connect account only applies to LinkedIn or Instagram accounts." };
  }
  if (!account.proxyHost) {
    return { ok: false as const, error: "Set up this account's proxy in Account Health before connecting." };
  }
  // Stale-connecting recovery: a session older than 15 minutes never got a
  // terminal status written (e.g. the droplet process crashed mid-session)
  // -- treat it as failed rather than blocking a retry forever. Matches
  // AccountHealthClient's own "Connecting… (stuck?)" UI affordance.
  const isStaleConnecting =
    account.loginStatus === "connecting" &&
    (!account.loginConnectingAt || Date.now() - account.loginConnectingAt.getTime() > 15 * 60 * 1000);
  if (account.loginStatus === "connecting" && !isStaleConnecting) {
    return { ok: false as const, error: "A connection attempt is already in progress for this account." };
  }

  await db.outreachAccount.updateMany({
    where: { id: accountId, tenantId: session.tenantId! },
    data: { loginStatus: "connecting", loginConnectingAt: new Date(), loginError: null },
  });

  const token = await new SignJWT({
    accountId,
    tenantId: session.tenantId!,
    purpose: "connect_account",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(getSecretKey());

  return {
    ok: true as const,
    wsUrl: `wss://${wsHost}/connect/${accountId}`,
    token,
  };
}

/**
 * Client-triggered fallback for the case where the browser tab detects the
 * websocket closed without a clean success/error message (network drop,
 * user navigated away) -- resets loginStatus back to "failed" so the UI
 * isn't stuck showing "Connecting…" indefinitely. The droplet's own
 * finally-block cleanup (live_login/session.py) is the primary path back
 * to a terminal state; this is defense-in-depth for the case that never
 * reaches the droplet at all (e.g. the websocket handshake itself failed).
 */
export async function cancelConnectAccountAction(accountId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "edit");
  if (!permCheck.ok) return permCheck;

  const account = await db.outreachAccount.findFirst({
    where: { id: accountId, tenantId: session.tenantId! },
  });
  if (!account) return { ok: false as const, error: "Account not found." };
  if (account.loginStatus !== "connecting") return { ok: true as const };

  await db.outreachAccount.updateMany({
    where: { id: accountId, tenantId: session.tenantId! },
    data: {
      loginStatus: "failed",
      loginConnectingAt: null,
      loginError: "Connection was cancelled or the browser tab closed before finishing.",
    },
  });

  return { ok: true as const };
}
