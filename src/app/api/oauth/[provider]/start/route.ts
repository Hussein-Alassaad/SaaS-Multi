import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getTenantSession, getSecretKey } from "@/lib/auth";
import { buildAuthorizeUrl, OAuthNotConfigured, type OAuthEmailProvider } from "@/lib/agency/oauth-providers";

const VALID_PROVIDERS: OAuthEmailProvider[] = ["GMAIL", "OUTLOOK"];

/**
 * Redirects the tenant's browser to Google's/Microsoft's own login+consent
 * page. Requires a real tenant session (this is reached by clicking
 * "Connect Gmail/Outlook" from inside the Agency dashboard, never a
 * standalone public URL) -- the tenantId is embedded in the signed `state`
 * JWT below so the callback route knows which tenant to save the resulting
 * Channel row against, without trusting anything client-supplied at
 * callback time (the callback only trusts what it can verify came from
 * THIS signature, minted THIS way, moments earlier).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toUpperCase() as OAuthEmailProvider;
  if (!VALID_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: `Unknown OAuth provider: ${rawProvider}` }, { status: 404 });
  }

  const session = await getTenantSession();
  if (!session) {
    return NextResponse.redirect(new URL("/agency-login", req.url));
  }

  // Short-lived (5 min -- this whole flow is a browser redirect round trip,
  // never meant to sit open) signed state token: standard OAuth2 CSRF
  // protection (an attacker can't forge a valid callback without the
  // AUTH_SECRET) AND how the callback recovers which tenant initiated this,
  // since the callback request comes from Google/Microsoft's server
  // redirecting the tenant's browser back, not from an authenticated
  // request this app made itself.
  const state = await new SignJWT({ tenantId: session.tenantId! })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(getSecretKey());

  let authorizeUrl: string;
  try {
    authorizeUrl = buildAuthorizeUrl(provider, state);
  } catch (err) {
    if (err instanceof OAuthNotConfigured) {
      // Redirects back to Integrations with a query flag rather than a raw
      // JSON error page -- this is reached by a tenant clicking a button in
      // the dashboard, not hitting an API directly, so the failure needs to
      // land somewhere with UI around it (see IntegrationsClient.tsx's
      // handling of ?oauthError=).
      const url = new URL("/agency/integrations", req.url);
      url.searchParams.set("oauthError", "not_configured");
      url.searchParams.set("oauthProvider", provider);
      return NextResponse.redirect(url);
    }
    throw err;
  }

  return NextResponse.redirect(authorizeUrl);
}
