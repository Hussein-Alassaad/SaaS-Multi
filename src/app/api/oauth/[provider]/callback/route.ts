import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSecretKey } from "@/lib/auth";
import { withTenant } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { exchangeCodeForTokens, type OAuthEmailProvider } from "@/lib/agency/oauth-providers";
import { logError } from "@/lib/error-log";

const VALID_PROVIDERS: OAuthEmailProvider[] = ["GMAIL", "OUTLOOK"];

function redirectWithError(req: NextRequest, code: string) {
  const url = new URL("/agency/integrations", req.url);
  url.searchParams.set("oauthError", code);
  return NextResponse.redirect(url);
}

/**
 * Google/Microsoft redirect the tenant's browser HERE after they approve
 * (or deny) the consent screen from start/route.ts. Every step below fails
 * closed -- a bad/missing/expired state, a denied consent, or a failed
 * token exchange all land on Integrations with a specific ?oauthError=
 * rather than silently doing nothing or (worse) saving a half-populated
 * Channel row.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: rawProvider } = await params;
  const provider = rawProvider.toUpperCase() as OAuthEmailProvider;
  if (!VALID_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: `Unknown OAuth provider: ${rawProvider}` }, { status: 404 });
  }

  const searchParams = req.nextUrl.searchParams;

  // The tenant clicking "Cancel"/"Deny" on Google's or Microsoft's own
  // consent screen is a normal, expected outcome, not a system error --
  // both providers redirect back with ?error=access_denied (or similar) in
  // that case, distinct from every other failure mode below.
  if (searchParams.get("error")) {
    return redirectWithError(req, "denied");
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    return redirectWithError(req, "missing_params");
  }

  let tenantId: string;
  try {
    const { payload } = await jwtVerify(state, getSecretKey());
    if (typeof payload.tenantId !== "string") throw new Error("state token missing tenantId");
    tenantId = payload.tenantId;
  } catch {
    // Expired (>5 min old, see start/route.ts), tampered, or forged --
    // either way, this is exactly the case OAuth2 state-checking exists to
    // catch. Never proceed without a verified tenantId.
    return redirectWithError(req, "invalid_state");
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(provider, code);
  } catch (err) {
    await logError({
      source: "agency.oauth.token_exchange",
      error: err,
      tenantId,
      context: { provider },
    });
    return redirectWithError(req, "exchange_failed");
  }

  const expiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);

  try {
    // tenantId here comes from the signed OAuth state token, verified above
    // (the code refuses to proceed without it), so it is safe to scope to.
    await withTenant(tenantId, (tx) =>
      tx.channel.upsert({
        where: { tenantId_provider: { tenantId, provider } },
      update: {
        status: "CONNECTED",
        displayName: tokens.email,
        connectedAt: new Date(),
        oauthEmail: tokens.email,
        oauthAccessToken: encryptSecret(tokens.accessToken),
        // Google omits refresh_token on a repeat consent unless
        // prompt=consent forces it (already set in buildAuthorizeUrl) --
        // but if a provider ever omits it anyway, keep whatever refresh
        // token is already on file rather than overwriting a working one
        // with null and silently breaking future token refreshes.
        ...(tokens.refreshToken ? { oauthRefreshToken: encryptSecret(tokens.refreshToken) } : {}),
        oauthExpiresAt: expiresAt,
      },
      create: {
        tenantId,
        provider,
        status: "CONNECTED",
        displayName: tokens.email,
        connectedAt: new Date(),
        oauthEmail: tokens.email,
        oauthAccessToken: encryptSecret(tokens.accessToken),
        oauthRefreshToken: tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
          oauthExpiresAt: expiresAt,
        },
      })
    );
  } catch (err) {
    await logError({
      source: "agency.oauth.save_channel",
      error: err,
      tenantId,
      context: { provider },
    });
    return redirectWithError(req, "save_failed");
  }

  const url = new URL("/agency/integrations", req.url);
  url.searchParams.set("oauthConnected", provider);
  return NextResponse.redirect(url);
}
