/**
 * Google (Gmail) and Microsoft (Outlook) OAuth 2.0 config + token exchange.
 *
 * Plain HTTP calls against each provider's own token endpoint -- no
 * `googleapis`/`@azure/msal-node` SDK dependency. Both providers' OAuth2
 * flows are simple enough (authorization-code + refresh-token grants) that
 * a full SDK would add weight without adding safety; every request/response
 * shape here is each provider's own publicly documented OAuth2 contract.
 *
 * The tenant NEVER enters their Gmail/Outlook password into this app --
 * they're redirected to Google's/Microsoft's own login+consent page
 * (start/route.ts), and only an authorization code comes back to us
 * (callback/route.ts), which is exchanged server-to-server for tokens. This
 * app only ever sees the resulting access/refresh tokens, not the password
 * -- see Channel model's oauthAccessToken/oauthRefreshToken comment in
 * prisma/schema.prisma for how those are stored (encrypted, src/lib/crypto.ts).
 *
 * SETUP REQUIRED (not done by this code -- a console step outside this
 * repo, real accounts needed before either provider works):
 *   - Google: console.cloud.google.com -> create a project -> OAuth consent
 *     screen -> OAuth client ID (Web application) -> add
 *     `${APP_URL}/api/oauth/GMAIL/callback` as an authorized redirect URI.
 *     Set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.
 *   - Microsoft: portal.azure.com -> App registrations -> New registration
 *     -> add `${APP_URL}/api/oauth/OUTLOOK/callback` as a redirect URI ->
 *     Certificates & secrets -> new client secret. Set
 *     MICROSOFT_OAUTH_CLIENT_ID / MICROSOFT_OAUTH_CLIENT_SECRET.
 * Until those env vars are set, startOAuthUrl() throws a clear
 * "not configured" error rather than redirecting to a broken/blank consent
 * screen -- see the "not configured" handling in start/route.ts.
 */

export type OAuthEmailProvider = "GMAIL" | "OUTLOOK";

interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  // Google/Microsoft both return the connected mailbox's own email address
  // from this same userinfo-style endpoint, needed to show the tenant which
  // account they connected (Channel.oauthEmail) without asking them to type
  // it in themselves (self-reported email is untrustworthy for this).
  userInfoUrl: string;
}

const PROVIDER_CONFIG: Record<OAuthEmailProvider, OAuthProviderConfig> = {
  GMAIL: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    // gmail.send (send on the tenant's behalf) + gmail.readonly (see inbound
    // replies) -- not the broader gmail.modify/full-mailbox scope, since
    // this app never needs to delete/organize the tenant's existing mail.
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
  },
  OUTLOOK: {
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // Mail.Send + Mail.Read via Microsoft Graph, same send/read-only
    // reasoning as Gmail's scopes above. offline_access is required to get
    // a refresh_token back at all -- Microsoft omits it otherwise.
    scopes: ["https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/Mail.Read", "offline_access", "openid", "email"],
    clientIdEnv: "MICROSOFT_OAUTH_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_OAUTH_CLIENT_SECRET",
    userInfoUrl: "https://graph.microsoft.com/v1.0/me",
  },
};

export class OAuthNotConfigured extends Error {}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new OAuthNotConfigured(`${key} is not set -- see src/lib/agency/oauth-providers.ts's module docstring for setup steps.`);
  }
  return value;
}

function redirectUri(provider: OAuthEmailProvider): string {
  const base = process.env.APP_URL;
  if (!base) throw new OAuthNotConfigured("APP_URL is not set.");
  return `${base}/api/oauth/${provider}/callback`;
}

/**
 * Builds the URL to send the tenant's browser to for Google's/Microsoft's
 * own login+consent screen. `state` is an opaque, server-generated value
 * (see start/route.ts) round-tripped through the provider and checked again
 * in the callback -- standard OAuth2 CSRF protection, not decorative.
 */
export function buildAuthorizeUrl(provider: OAuthEmailProvider, state: string): string {
  const config = PROVIDER_CONFIG[provider];
  const params = new URLSearchParams({
    client_id: requireEnv(config.clientIdEnv),
    redirect_uri: redirectUri(provider),
    response_type: "code",
    scope: config.scopes.join(" "),
    state,
    access_type: "offline", // Google-specific: required to get a refresh_token; harmless extra param for Microsoft
    prompt: "consent", // forces the consent screen (and a fresh refresh_token) even if the tenant connected before
  });
  return `${config.authorizeUrl}?${params.toString()}`;
}

export interface ExchangedTokens {
  accessToken: string;
  refreshToken: string | null; // null on a re-consent where the provider doesn't re-issue one -- callers must handle this, not assume it's always present
  expiresInSeconds: number;
  email: string;
}

/**
 * Server-to-server: exchanges the authorization code (from the callback's
 * `?code=`) for real tokens, then fetches the connected mailbox's email
 * address. Throws on any failure -- the callback route (callback/route.ts)
 * is responsible for turning that into a user-facing error, not this
 * function guessing at a partial/fallback result.
 */
export async function exchangeCodeForTokens(provider: OAuthEmailProvider, code: string): Promise<ExchangedTokens> {
  const config = PROVIDER_CONFIG[provider];
  const clientId = requireEnv(config.clientIdEnv);
  const clientSecret = requireEnv(config.clientSecretEnv);

  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri(provider),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`${provider} token exchange failed: HTTP ${tokenResponse.status}: ${(await tokenResponse.text()).slice(0, 300)}`);
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const userInfoResponse = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!userInfoResponse.ok) {
    throw new Error(`${provider} userinfo lookup failed: HTTP ${userInfoResponse.status}`);
  }
  const userInfo = (await userInfoResponse.json()) as { email?: string; mail?: string; userPrincipalName?: string };
  // Google's userinfo returns `email`; Microsoft Graph's /me returns `mail`
  // (or `userPrincipalName` as a fallback for accounts where `mail` is
  // unset, e.g. some personal Microsoft accounts) -- different field names
  // per provider, normalised here so callers don't need to know that.
  const email = userInfo.email ?? userInfo.mail ?? userInfo.userPrincipalName;
  if (!email) {
    throw new Error(`${provider} userinfo response had no usable email field.`);
  }

  return {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresInSeconds: tokenData.expires_in,
    email,
  };
}

/**
 * Exchanges a stored refresh token for a new access token -- called by the
 * send/read code path (not built in this pass -- see PROGRESS.md) once an
 * access token is past Channel.oauthExpiresAt. Refresh tokens themselves
 * don't rotate on every use for either provider (Google/Microsoft both
 * treat them as long-lived unless explicitly revoked), so this never
 * receives or stores a new refreshToken -- only Google ever returns one on
 * refresh, and even then it's optional to honor.
 */
export async function refreshAccessToken(provider: OAuthEmailProvider, refreshToken: string): Promise<{ accessToken: string; expiresInSeconds: number }> {
  const config = PROVIDER_CONFIG[provider];
  const clientId = requireEnv(config.clientIdEnv);
  const clientSecret = requireEnv(config.clientSecretEnv);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`${provider} token refresh failed: HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}
