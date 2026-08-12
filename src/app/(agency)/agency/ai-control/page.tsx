import { getChannelsWithDefaults } from "@/lib/agency/channels";
import { getAiSettings } from "@/lib/agency/settings";
import { getTenantSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { type UiLanguage } from "@/lib/i18n";
import { AiControlClient } from "./AiControlClient";

export default async function AiControlCenterPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const [channels, settings, activeConversations, pendingApprovals] = await Promise.all([
    getChannelsWithDefaults(tenantId),
    getAiSettings(tenantId),
    db.conversation.count({ where: { tenantId, status: { in: ["OPEN", "PENDING_APPROVAL"] } } }),
    db.message.count({ where: { status: "PENDING_APPROVAL", conversation: { tenantId } } }),
  ]);

  return (
    <AiControlClient
      channels={channels.map((c) => ({
        provider: c.provider,
        status: c.status,
        displayName: c.displayName,
      }))}
      settings={{
        tone: settings.tone,
        primaryLanguage: settings.primaryLanguage,
        allowEnglish: settings.allowEnglish,
        approvalRequired: settings.approvalRequired,
        model: settings.model,
        qualificationRules: settings.qualificationRules,
      }}
      activeConversations={activeConversations}
      pendingApprovals={pendingApprovals}
      lang={lang}
    />
  );
}
