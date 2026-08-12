import { getAiSettings } from "@/lib/agency/settings";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const settings = await getAiSettings(tenantId);

  return (
    <SettingsClient
      settings={{
        tone: settings.tone,
        primaryLanguage: settings.primaryLanguage,
        allowEnglish: settings.allowEnglish,
        qualificationRules: settings.qualificationRules,
        approvalRequired: settings.approvalRequired,
        model: settings.model,
      }}
      lang={lang}
    />
  );
}
