/**
 * Split out of src/lib/agency/channels.ts into its own file with NO other
 * imports, same fix and same reasoning as src/lib/outreach/pipeline-stages.ts
 * -- channels.ts imports src/lib/db.ts (withTenant), which imports
 * src/lib/env.ts, which throws at module-evaluation time if
 * process.env.AUTH_SECRET is unset. IntegrationsClient.tsx ("use client")
 * imported OAUTH_CHANNEL_PROVIDERS/OAuthChannelProvider directly from
 * channels.ts -- Next's client bundler can't tree-shake out just the
 * constant, so it pulled the whole module graph (channels.ts -> db.ts ->
 * env.ts) into the browser bundle, where process.env.AUTH_SECRET is never
 * defined, crashing the Integrations page on load in production regardless
 * of what was actually configured on the server. See pipeline-stages.ts's
 * own docstring for the original discovery of this bug class.
 */
export const CHANNEL_PROVIDERS = ["WHATSAPP", "INSTAGRAM", "FACEBOOK", "GMAIL", "OUTLOOK"] as const;
export type ChannelProvider = (typeof CHANNEL_PROVIDERS)[number];

// The two providers with a real OAuth connect/disconnect flow (see
// src/lib/agency/oauth-providers.ts) -- WHATSAPP/INSTAGRAM/FACEBOOK still
// use the simulated status-toggle in agency-integrations.ts's
// toggleChannelConnectionAction until Meta Business verification is done.
export const OAUTH_CHANNEL_PROVIDERS = ["GMAIL", "OUTLOOK"] as const;
export type OAuthChannelProvider = (typeof OAUTH_CHANNEL_PROVIDERS)[number];
