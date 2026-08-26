"use client";

import { useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";
import { toggleChannelConnectionAction, disconnectOAuthChannelAction } from "@/lib/actions/agency-integrations";
import { OAUTH_CHANNEL_PROVIDERS, type OAuthChannelProvider } from "@/lib/agency/channels";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { MessageCircle, Camera, ThumbsUp, Mail } from "lucide-react";

interface ChannelRow {
  provider: string;
  status: string;
  displayName: string | null;
  connectedAt: string | null;
}

function getChannelMeta(t: ReturnType<typeof getDictionary>): Record<string, { label: string; icon: typeof MessageCircle; description: string }> {
  return {
    WHATSAPP: {
      label: t.integrations.whatsappLabel,
      icon: MessageCircle,
      description: t.integrations.whatsappDescription,
    },
    INSTAGRAM: {
      label: t.integrations.instagramLabel,
      icon: Camera,
      description: t.integrations.instagramDescription,
    },
    FACEBOOK: {
      label: t.integrations.facebookLabel,
      icon: ThumbsUp,
      description: t.integrations.facebookDescription,
    },
    GMAIL: {
      label: t.integrations.gmailLabel,
      icon: Mail,
      description: t.integrations.gmailDescription,
    },
    OUTLOOK: {
      label: t.integrations.outlookLabel,
      icon: Mail,
      description: t.integrations.outlookDescription,
    },
  };
}

function isOAuthProvider(provider: string): provider is OAuthChannelProvider {
  return (OAUTH_CHANNEL_PROVIDERS as readonly string[]).includes(provider);
}

export function IntegrationsClient({ channels, lang }: { channels: ChannelRow[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const CHANNEL_META = getChannelMeta(t);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // OAuth is a full-page redirect round trip (start/route.ts ->
  // Google/Microsoft's own consent page -> callback/route.ts), so its
  // result comes back as a query param on this same page, not a client-side
  // action response the way the simulated toggle below works.
  const oauthConnected = searchParams.get("oauthConnected");
  const oauthError = searchParams.get("oauthError");

  useEffect(() => {
    if (oauthConnected || oauthError) {
      // Clears the query params after showing the result once, so a
      // refresh doesn't re-show a stale "connected"/error banner.
      const url = new URL(window.location.href);
      url.searchParams.delete("oauthConnected");
      url.searchParams.delete("oauthError");
      url.searchParams.delete("oauthProvider");
      router.replace(url.pathname + url.search, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthConnected, oauthError]);

  const handleToggle = (provider: string, connect: boolean) => {
    startTransition(async () => {
      await toggleChannelConnectionAction(provider as "WHATSAPP" | "INSTAGRAM" | "FACEBOOK", connect);
      router.refresh();
    });
  };

  const handleOAuthDisconnect = (provider: OAuthChannelProvider) => {
    startTransition(async () => {
      await disconnectOAuthChannelAction(provider);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.integrations.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">
          {t.integrations.subtitle}
        </p>
        <p className="mt-1 text-xs text-[var(--text-5)]">
          {t.integrations.simulatedHint}
        </p>
      </div>

      {oauthConnected && (
        <div className="rounded-lg border border-[var(--status-cold)]/30 bg-[var(--status-cold)]/10 px-4 py-3 text-sm text-[var(--status-cold)]">
          {CHANNEL_META[oauthConnected]?.label ?? oauthConnected} {t.integrations.statusConnected.toLowerCase()}.
        </div>
      )}
      {oauthError && (
        <div className="rounded-lg border border-[var(--status-hot)]/30 bg-[var(--status-hot)]/10 px-4 py-3 text-sm text-[var(--status-hot)]">
          {oauthError === "not_configured"
            ? t.integrations.oauthNotConfigured
            : oauthError === "denied"
              ? t.integrations.oauthDenied
              : t.integrations.oauthFailed}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {channels.map((c) => {
          const meta = CHANNEL_META[c.provider];
          const Icon = meta?.icon ?? MessageCircle;
          const connected = c.status === "CONNECTED";
          const oauth = isOAuthProvider(c.provider);

          return (
            <Card key={c.provider} padding="md">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--surface-2)]">
                    <Icon className="h-4.5 w-4.5 text-[var(--text-2)]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--text-1)]">{meta?.label ?? c.provider}</p>
                    <Badge variant={connected ? "success" : "outline"}>
                      {connected ? t.integrations.statusConnected : t.integrations.statusDisconnected}
                    </Badge>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-[var(--text-4)]">{meta?.description}</p>
              {connected && oauth && c.displayName && (
                <p className="mt-2 text-[10px] text-[var(--text-5)]">
                  {t.integrations.oauthConnectAs} {c.displayName}
                </p>
              )}
              {connected && !oauth && c.connectedAt && (
                <p className="mt-2 text-[10px] text-[var(--text-5)]">{t.integrations.connected} {formatDateTime(c.connectedAt)}</p>
              )}

              {oauth ? (
                connected ? (
                  <Button
                    className="mt-3 w-full"
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => isOAuthProvider(c.provider) && handleOAuthDisconnect(c.provider)}
                  >
                    {t.common.disconnect}
                  </Button>
                ) : (
                  // Real full-page navigation to start/route.ts, not a
                  // client-side action -- OAuth requires leaving this page
                  // entirely to reach Google's/Microsoft's own login screen.
                  <a href={`/api/oauth/${c.provider}/start`} className="mt-3 block">
                    <Button className="w-full" variant="primary" size="sm">
                      {t.common.connect}
                    </Button>
                  </a>
                )
              ) : (
                <Button
                  className="mt-3 w-full"
                  variant={connected ? "outline" : "primary"}
                  size="sm"
                  disabled={pending}
                  onClick={() => handleToggle(c.provider, !connected)}
                >
                  {connected ? t.common.disconnect : t.common.connect}
                </Button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
