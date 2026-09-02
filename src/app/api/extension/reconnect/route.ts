import { NextRequest, NextResponse } from "next/server";
import { toPlaywrightCookies, type ExtensionCookie } from "@/lib/extension-cookies";

/**
 * One-click reconnect for the Nexaris Connect Chrome extension -- the
 * counterpart to /api/extension/import-session's first-ever-connect flow.
 * That route needs a dashboard-generated code (a real tenant session had
 * to click "Connect via extension" moments earlier); this one doesn't --
 * the extension itself proves it's allowed to reconnect this exact
 * account by presenting the opaque `reconnectToken` import-session handed
 * back on that FIRST successful connect (saved into the extension's own
 * chrome.storage.local, see popup.js). No tenant session, no code, no
 * trip back to the dashboard -- open the extension, click Reconnect.
 *
 * This route itself does no auth decision at all -- it's a thin relay
 * (same cookie-shape conversion as import-session) to the droplet's
 * /session/{accountId}/reconnect endpoint (live_login/import_server.py),
 * which is the thing that actually verifies the token against
 * OutreachAccount.extensionReconnectToken (exact match, not a JWT --
 * there's no tenant-session claim to check on a reconnect click days
 * later, only "does this extension hold the right token").
 */
export async function POST(request: NextRequest) {
  let body: { accountId?: string; reconnectToken?: string; cookies?: ExtensionCookie[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { accountId, reconnectToken, cookies } = body;
  if (!accountId || typeof accountId !== "string") {
    return NextResponse.json({ error: "Missing accountId." }, { status: 400 });
  }
  if (!reconnectToken || typeof reconnectToken !== "string") {
    return NextResponse.json({ error: "Missing reconnect token." }, { status: 400 });
  }
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return NextResponse.json({ error: "Missing or empty cookies array." }, { status: 400 });
  }

  const wsHost = process.env.LIVE_LOGIN_WS_HOST;
  if (!wsHost) {
    return NextResponse.json({ error: "Session import isn't configured on this deployment yet." }, { status: 503 });
  }

  let response: Response;
  try {
    response = await fetch(`https://${wsHost}/session/${accountId}/reconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reconnectToken, cookies: toPlaywrightCookies(cookies) }),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the login server. Try again in a moment." }, { status: 502 });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return NextResponse.json({ error: text || `Reconnect failed (${response.status}).` }, { status: response.status === 401 ? 401 : 502 });
  }

  return NextResponse.json({ ok: true });
}
