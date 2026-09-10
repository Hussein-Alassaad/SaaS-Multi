import { getAiSettings } from "@/lib/agency/settings";
import { getTenantSession } from "@/lib/auth";
import { type UiLanguage } from "@/lib/i18n";
import { getCompanySettingsAction } from "@/lib/actions/marketing-settings";
import { getLocalizationSettingsAction } from "@/lib/actions/marketing-localization";
import { getSmtpConfigAction } from "@/lib/actions/marketing-smtp";
import { SettingsTabs } from "./SettingsTabs";

export default async function SettingsPage() {
  const session = await getTenantSession();
  const tenantId = session!.tenantId!;
  const lang = (session!.uiLanguage as UiLanguage) ?? "EN";

  const [aiSettings, companyResult, localizationResult, smtpResult] = await Promise.all([
    getAiSettings(tenantId),
    getCompanySettingsAction(),
    getLocalizationSettingsAction(),
    getSmtpConfigAction(),
  ]);

  return (
    <SettingsTabs
      lang={lang}
      aiSettings={{
        tone: aiSettings.tone,
        primaryLanguage: aiSettings.primaryLanguage,
        allowEnglish: aiSettings.allowEnglish,
        qualificationRules: aiSettings.qualificationRules,
        approvalRequired: aiSettings.approvalRequired,
        model: aiSettings.model,
      }}
      companySettings={
        companyResult.ok
          ? {
              companyName: companyResult.settings.companyName ?? "",
              logoUrl: companyResult.settings.logoUrl ?? "",
              website: companyResult.settings.website ?? "",
              primaryColor: companyResult.settings.primaryColor ?? "",
              secondaryColor: companyResult.settings.secondaryColor ?? "",
              fontFamily: companyResult.settings.fontFamily ?? "",
              senderName: companyResult.settings.senderName ?? "",
              emailSignature: companyResult.settings.emailSignature ?? "",
              voiceTone: companyResult.settings.voiceTone ?? "",
            }
          : null
      }
      localizationSettings={localizationResult.ok ? localizationResult.settings : null}
      smtpConfig={
        smtpResult.ok && smtpResult.config
          ? {
              host: smtpResult.config.host,
              port: smtpResult.config.port,
              username: smtpResult.config.username,
              useTls: smtpResult.config.useTls,
              fromEmail: smtpResult.config.fromEmail,
              fromName: smtpResult.config.fromName,
              lastTestedAt: smtpResult.config.lastTestedAt ? smtpResult.config.lastTestedAt.toISOString() : null,
              lastTestOk: smtpResult.config.lastTestOk,
            }
          : null
      }
    />
  );
}
