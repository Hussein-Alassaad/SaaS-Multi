"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";
import { toggleChannelConnectionAction } from "@/lib/actions/agency-integrations";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { MessageCircle, Camera, ThumbsUp } from "lucide-react";

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
  };
}

export function IntegrationsClient({ channels, lang }: { channels: ChannelRow[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const CHANNEL_META = getChannelMeta(t);
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleToggle = (provider: string, connect: boolean) => {
    startTransition(async () => {
      await toggleChannelConnectionAction(provider as "WHATSAPP" | "INSTAGRAM" | "FACEBOOK", connect);
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {channels.map((c) => {
          const meta = CHANNEL_META[c.provider];
          const Icon = meta?.icon ?? MessageCircle;
          const connected = c.status === "CONNECTED";
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
              {connected && c.connectedAt && (
                <p className="mt-2 text-[10px] text-[var(--text-5)]">{t.integrations.connected} {formatDateTime(c.connectedAt)}</p>
              )}
              <Button
                className="mt-3 w-full"
                variant={connected ? "outline" : "primary"}
                size="sm"
                disabled={pending}
                onClick={() => handleToggle(c.provider, !connected)}
              >
                {connected ? t.common.disconnect : t.common.connect}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
