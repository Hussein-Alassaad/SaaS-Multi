"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { updateAiSettingsAction } from "@/lib/actions/agency-settings";
import { getDictionary, type UiLanguage } from "@/lib/i18n";

interface AiSettingsForm {
  tone: string;
  primaryLanguage: string;
  allowEnglish: boolean;
  qualificationRules: string;
  approvalRequired: boolean;
  model: string;
}

const MODEL_OPTIONS = [{ value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" }];

export function SettingsClient({ settings, lang }: { settings: AiSettingsForm; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const TONE_OPTIONS = [
    { value: "PROFESSIONAL", label: t.settings.toneProfessional },
    { value: "FRIENDLY", label: t.settings.toneFriendly },
    { value: "FORMAL", label: t.settings.toneFormal },
  ];
  const LANGUAGE_OPTIONS = [
    { value: "AR", label: t.settings.arabic },
    { value: "EN", label: t.settings.english },
  ];
  const router = useRouter();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    setSaved(false);
    startTransition(async () => {
      const result = await updateAiSettingsAction(form);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-1)]">{t.settings.title}</h1>
        <p className="text-sm text-[var(--text-4)] mt-1">{t.settings.subtitle}</p>
      </div>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>{t.settings.aiPersonality}</CardTitle>
            <CardDescription>{t.settings.aiPersonalitySubtitle}</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">{t.settings.tone}</label>
            <Select
              value={form.tone}
              onValueChange={(v) => setForm((f) => ({ ...f, tone: v }))}
              options={TONE_OPTIONS}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">{t.settings.primaryLanguage}</label>
            <Select
              value={form.primaryLanguage}
              onValueChange={(v) => setForm((f) => ({ ...f, primaryLanguage: v }))}
              options={LANGUAGE_OPTIONS}
            />
          </div>
          <Toggle
            checked={form.allowEnglish}
            onCheckedChange={(v) => setForm((f) => ({ ...f, allowEnglish: v }))}
            label={t.settings.allowEnglishFallback}
            description={t.settings.allowEnglishFallbackDescription}
          />
        </div>
      </Card>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>{t.settings.qualificationRules}</CardTitle>
            <CardDescription>{t.settings.qualificationRulesSubtitle}</CardDescription>
          </div>
        </CardHeader>
        <textarea
          value={form.qualificationRules}
          onChange={(e) => setForm((f) => ({ ...f, qualificationRules: e.target.value }))}
          placeholder={t.settings.qualificationRulesPlaceholder}
          rows={5}
          className="flex w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] outline-none"
        />
      </Card>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>{t.settings.safetyAndModel}</CardTitle>
            <CardDescription>{t.settings.safetyAndModelSubtitle}</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-4">
          <Toggle
            checked={form.approvalRequired}
            onCheckedChange={(v) => setForm((f) => ({ ...f, approvalRequired: v }))}
            label={t.settings.requireApprovalAll}
            description={t.settings.requireApprovalAllDescription}
          />
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">{t.settings.model}</label>
            <Select
              value={form.model}
              onValueChange={(v) => setForm((f) => ({ ...f, model: v }))}
              options={MODEL_OPTIONS}
            />
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={handleSave}>
          {pending ? t.settings.saving : t.settings.saveSettings}
        </Button>
        {saved && <span className="text-xs text-[#4fd293]">{t.settings.saved}</span>}
      </div>
    </div>
  );
}
