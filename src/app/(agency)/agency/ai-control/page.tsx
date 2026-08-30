import { getAiControlPageData } from "@/lib/agency/settings";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { AiControlClient } from "./AiControlClient";

export default async function AiControlCenterPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  // One withTenant() scope for all four reads -- see getAiControlPageData.
  const { channels, settings, activeConversations, pendingApprovals } =
    await getAiControlPageData(tenantId);

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
