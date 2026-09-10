"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { getDictionary, type UiLanguage } from "@/lib/i18n";
import { SettingsClient } from "./SettingsClient";
import { CompanySettingsTab, type CompanySettingsForm } from "./CompanySettingsTab";
import { SmtpSettingsTab, type SmtpConfigView } from "./SmtpSettingsTab";
import { LocalizationTab, type LocalizationSettingsForm } from "./LocalizationTab";

interface AiSettingsForm {
  tone: string;
  primaryLanguage: string;
  allowEnglish: boolean;
  qualificationRules: string;
  approvalRequired: boolean;
  model: string;
}

export function SettingsTabs({
  lang,
  aiSettings,
  companySettings,
  localizationSettings,
  smtpConfig,
}: {
  lang: UiLanguage;
  aiSettings: AiSettingsForm;
  companySettings: CompanySettingsForm | null;
  localizationSettings: LocalizationSettingsForm | null;
  smtpConfig: SmtpConfigView | null;
}) {
  const t = getDictionary(lang);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.settings.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">{t.settings.subtitle}</p>
      </div>

      <Tabs defaultValue="ai">
        <TabsList>
          <TabsTrigger value="ai">AI Settings</TabsTrigger>
          <TabsTrigger value="company">Company & Brand</TabsTrigger>
          <TabsTrigger value="smtp">SMTP</TabsTrigger>
          <TabsTrigger value="localization">Localization</TabsTrigger>
        </TabsList>

        <TabsContent value="ai">
          <SettingsClient settings={aiSettings} lang={lang} />
        </TabsContent>
        <TabsContent value="company">
          <CompanySettingsTab settings={companySettings} />
        </TabsContent>
        <TabsContent value="smtp">
          <SmtpSettingsTab config={smtpConfig} />
        </TabsContent>
        <TabsContent value="localization">
          <LocalizationTab settings={localizationSettings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
