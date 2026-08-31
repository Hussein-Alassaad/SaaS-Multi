import { NextRequest, NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { getSecretKey } from "@/lib/auth";

/**
 * Receives an already-logged-in LinkedIn/Instagram session from the
 * Nexaris Connect Chrome extension -- the alternative to the VNC-based
 * Connect Account flow (see AccountHealthClient.tsx's "Connect via
 * extension" button, added alongside the original, not replacing it).
 *
 * A browser extension can't call a Next.js server action directly (those
 * only work from this app's own client bundle) -- this is why the
 * extension's target is a plain Route Handler instead, unlike every other
 * piece of this feature which uses server actions.
 *
 * Two separate short-lived JWTs are involved here, each scoped to its own
 * hop, neither reusable as the other:
 *   1. `code` in the request body -- minted by mintImportSessionCodeAction
 *      (purpose="import_session_code", 10 min), verified HERE. Proves the
 *      tenant who clicked "Connect via extension" on the dashboard
 *      actually owns this account.
 *   2. A second token minted by THIS route (purpose="import_session",
 *      120s) to authenticate the actual droplet call below -- the
 *      extension/browser never sees this one, and it can never be reused
 *      to replay a connect/disconnect against the droplet's other
 *      endpoints.
 *
 * This route does the format conversion (the extension sends a raw
 * chrome.cookies.getAll() array; the droplet's import endpoint expects
 * Playwright's storage_state cookie shape) -- see the mapping below --
 * then forwards to the droplet, which is the only thing with filesystem
 * access to write browser_profiles/{accountId}.json (a different
 * machine, not reachable from this Vercel deployment).
 */

interface ExtensionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expirationDate?: number; // chrome.cookies' field name -- seconds since epoch, absent for session cookies
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "no_restriction" | "lax" | "strict" | "unspecified";
}

const SAME_SITE_MAP: Record<string, "Strict" | "Lax" | "None"> = {
  strict: "Strict",
  lax: "Lax",
  no_restriction: "None",
  unspecified: "Lax", // Playwright requires a value; Chrome's own default behavior is Lax
};

function toPlaywrightCookies(cookies: ExtensionCookie[]) {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    // Playwright wants epoch seconds, -1 for a session cookie (no
    // expirationDate) -- chrome.cookies already reports epoch seconds,
    // no unit conversion needed, just the session-cookie fallback.
    expires: c.expirationDate ?? -1,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: SAME_SITE_MAP[c.sameSite ?? "unspecified"],
  }));
}

export async function POST(request: NextRequest) {
  let body: { code?: string; cookies?: ExtensionCookie[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { code, cookies } = body;
  if (!code || typeof code !== "string") {
    return NextResponse.json({ error: "Missing code." }, { status: 400 });
  }
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return NextResponse.json({ error: "Missing or empty cookies array." }, { status: 400 });
  }

  let accountId: string;
  let tenantId: string;
  try {
    const { payload } = await jwtVerify(code, getSecretKey());
    if (payload.purpose !== "import_session_code") {
      return NextResponse.json({ error: "Invalid code." }, { status: 401 });
    }
    accountId = payload.accountId as string;
    tenantId = payload.tenantId as string;
    if (!accountId || !tenantId) {
      return NextResponse.json({ error: "Invalid code." }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "This code is invalid or has expired. Generate a new one from the dashboard." }, { status: 401 });
  }

  const wsHost = process.env.LIVE_LOGIN_WS_HOST;
  if (!wsHost) {
    return NextResponse.json({ error: "Session import isn't configured on this deployment yet." }, { status: 503 });
  }

  const dropletToken = await new SignJWT({
    accountId,
    tenantId,
    purpose: "import_session",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("120s")
    .sign(getSecretKey());

  let response: Response;
  try {
    response = await fetch(`https://${wsHost}/session/${accountId}/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${dropletToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ cookies: toPlaywrightCookies(cookies) }),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach the login server. Try again in a moment." }, { status: 502 });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return NextResponse.json({ error: text || `Import failed (${response.status}).` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
