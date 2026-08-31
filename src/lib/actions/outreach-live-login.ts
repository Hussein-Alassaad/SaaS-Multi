"use server";

import { SignJWT } from "jose";
import { withTenant } from "@/lib/db";
import { getTenantSession, getSecretKey } from "@/lib/auth";
import { outreachGuardResult } from "@/lib/outreach-permissions";

export type ConnectAccountStatus = "not_connected" | "pending_first_login" | "connecting" | "connected" | "failed";

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

  const account = await withTenant(session.tenantId!, (tx) =>
    tx.outreachAccount.findFirst({
      where: { id: accountId, tenantId: session.tenantId! },
    })
  );
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

  await withTenant(session.tenantId!, (tx) =>
    tx.outreachAccount.updateMany({
      where: { id: accountId, tenantId: session.tenantId! },
      data: { loginStatus: "connecting", loginConnectingAt: new Date(), loginError: null },
    })
  );

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

  const result = await withTenant(session.tenantId!, async (tx) => {
    const account = await tx.outreachAccount.findFirst({
      where: { id: accountId, tenantId: session.tenantId! },
    });
    if (!account) return "not_found" as const;
    if (account.loginStatus !== "connecting") return "not_connecting" as const;

    await tx.outreachAccount.updateMany({
      where: { id: accountId, tenantId: session.tenantId! },
      data: {
        loginStatus: "failed",
        loginConnectingAt: null,
        loginError: "Connection was cancelled or the browser tab closed before finishing.",
      },
    });
    return "reset" as const;
  });
  if (result === "not_found") return { ok: false as const, error: "Account not found." };

  return { ok: true as const };
}

/**
 * Polled from ConnectAccountModal.tsx (every couple seconds) while the VNC
 * session is open, to detect when the droplet's own background watcher
 * (live_login/server.py's _watch_login_and_persist) has written a terminal
 * loginStatus. Replaces the old websocket "success"/"error" messages --
 * the VNC socket now carries pure RFB protocol for noVNC's RFB client, so
 * there's no channel left to push that event over; polling the row this
 * app already treats as the source of truth is simpler than inventing a
 * second side-channel just for this one signal.
 */
export async function getConnectAccountStatusAction(accountId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };

  const account = await withTenant(session.tenantId!, (tx) =>
    tx.outreachAccount.findFirst({
      where: { id: accountId, tenantId: session.tenantId! },
      select: { loginStatus: true, loginError: true },
    })
  );
  if (!account) return { ok: false as const, error: "Account not found." };

  return {
    ok: true as const,
    status: account.loginStatus as ConnectAccountStatus,
    error: account.loginError,
  };
}

/**
 * Disconnects a LinkedIn/Instagram account: deletes the saved login
 * session on the droplet (browser_profiles/{accountId}.json -- the file
 * the scheduler's own SessionManager reads on every real run) and resets
 * loginStatus back to "not_connected". Unlike startConnectAccountAction,
 * this is a one-shot request/response, not a persistent stream, so this
 * server action makes the call to the droplet directly (a plain HTTPS
 * POST) rather than handing the browser a URL to open itself -- there's
 * no long-lived connection here for a Vercel serverless function to be
 * unable to hold open.
 *
 * The droplet is the only thing that can actually delete that file (it's
 * a different machine's filesystem, not reachable from this Vercel
 * deployment) -- see live_login/server.py's disconnect handler, gated by
 * the same short-lived JWT scheme startConnectAccountAction already uses,
 * just with purpose="disconnect_account" so a leaked connect token can
 * never be replayed to disconnect an account and vice versa.
 */
export async function disconnectAccountAction(accountId: string) {
  const session = await getTenantSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  const permCheck = outreachGuardResult(session.role?.name ?? "", "accounts", "edit");
  if (!permCheck.ok) return permCheck;

  const wsHost = process.env.LIVE_LOGIN_WS_HOST;
  if (!wsHost) {
    return { ok: false as const, error: "Live login isn't configured on this deployment yet." };
  }

  const account = await withTenant(session.tenantId!, (tx) =>
    tx.outreachAccount.findFirst({
      where: { id: accountId, tenantId: session.tenantId! },
    })
  );
  if (!account) return { ok: false as const, error: "Account not found." };
  if (account.platform !== "linkedin" && account.platform !== "instagram") {
    return { ok: false as const, error: "Disconnect only applies to LinkedIn or Instagram accounts." };
  }
  if (account.loginStatus === "connecting") {
    return { ok: false as const, error: "A connection attempt is currently in progress for this account." };
  }

  const token = await new SignJWT({
    accountId,
    tenantId: session.tenantId!,
    purpose: "disconnect_account",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(getSecretKey());

  let response: Response;
  try {
    response = await fetch(`https://${wsHost}/connect/${accountId}/disconnect`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false as const, error: "Could not reach the login server. Try again in a moment." };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false as const, error: text || `Disconnect failed (${response.status}).` };
  }

  return { ok: true as const };
}
