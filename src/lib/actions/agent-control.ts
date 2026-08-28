"use server";

import { SignJWT } from "jose";
import { withPlatformAccess } from "@/lib/db";
import { getSession, getSecretKey } from "@/lib/auth";
import { guard } from "@/lib/permissions";

export type AgentControlActionName = "start" | "stop" | "status";

/**
 * Bridges the Admin dashboard to the scheduler container's real state on
 * the droplet -- there is no way to control an always-on Docker process
 * from Vercel serverless itself, so this mints a short-lived token (same
 * jose/AUTH_SECRET convention as startConnectAccountAction in
 * outreach-live-login.ts) and calls the droplet's own control/server.py
 * directly, THEN relays its JSON response back to the client. Unlike
 * live-login's websocket flow, this is plain request/response, so the
 * server action itself makes the call rather than handing the browser a
 * URL to open directly -- no long-lived connection to keep alive.
 */
export async function agentControlAction(action: AgentControlActionName) {
  const session = await getSession();
  if (!session) return { ok: false as const, error: "Not authenticated." };
  guard(session.role?.name ?? "", "agent-control", "manage");

  const controlHost = process.env.LIVE_LOGIN_WS_HOST;
  if (!controlHost) {
    return { ok: false as const, error: "Agent control isn't configured on this deployment yet." };
  }

  const token = await new SignJWT({
    purpose: "agent_control",
    action,
    adminUserId: session.id,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("60s")
    .sign(getSecretKey());

  let response: Response;
  try {
    response = await fetch(`https://${controlHost}/control`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
      cache: "no-store",
    });
  } catch {
    return { ok: false as const, error: "Could not reach the agent control service." };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false as const, error: body?.error ?? `Agent control returned HTTP ${response.status}.` };
  }

  // Only audit state-changing actions -- a status poll (e.g. the panel's
  // own periodic refresh) isn't a meaningful admin action to log, same
  // convention as every other read-only fetch in this codebase.
  if (action !== "status") {
    await withPlatformAccess((tx) =>
      tx.auditLog.create({
        data: {
          actorId: session.id,
          action: `outreach_agent.${action}`,
          resource: "outreach_agent",
          newValue: JSON.stringify({ status: body?.status }),
          device: "Desktop",
          browser: "Admin",
        },
      })
    );
  }

  return { ok: true as const, status: body?.status as string };
}
