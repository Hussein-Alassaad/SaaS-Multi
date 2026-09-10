"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { updateLocalizationAction } from "@/lib/actions/marketing-localization";
import { LOCALIZATION_LANGUAGES, type LocalizationLanguage } from "@/types/marketing-settings";

export interface LocalizationSettingsForm {
  defaultLanguage: string;
  timezone: string;
  dateFormat: string;
  numberFormat: string;
}

const DEFAULT: LocalizationSettingsForm = {
  defaultLanguage: "en",
  timezone: "UTC",
  dateFormat: "MM/DD/YYYY",
  numberFormat: "en-US",
};

const LANGUAGE_LABELS: Record<string, string> = { en: "English", ar: "Arabic", fr: "French", es: "Spanish" };
const LANGUAGE_OPTIONS = LOCALIZATION_LANGUAGES.map((v) => ({ value: v, label: LANGUAGE_LABELS[v] ?? v }));
const DATE_FORMAT_OPTIONS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD" },
];

export function LocalizationTab({ settings }: { settings: LocalizationSettingsForm | null }) {
  const router = useRouter();
  const [form, setForm] = useState(settings ?? DEFAULT);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await updateLocalizationAction({
        ...form,
        defaultLanguage: form.defaultLanguage as LocalizationLanguage,
      });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>Language & region</CardTitle>
            <CardDescription>Defaults used for campaigns and dashboard formatting.</CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Default language</label>
            <Select
              value={form.defaultLanguage}
              onValueChange={(v) => setForm((f) => ({ ...f, defaultLanguage: v }))}
              options={LANGUAGE_OPTIONS}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Timezone (IANA)</label>
            <Input
              placeholder="Asia/Beirut"
              value={form.timezone}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Date format</label>
            <Select
              value={form.dateFormat}
              onValueChange={(v) => setForm((f) => ({ ...f, dateFormat: v }))}
              options={DATE_FORMAT_OPTIONS}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Number format locale</label>
            <Input
              placeholder="en-US"
              value={form.numberFormat}
              onChange={(e) => setForm((f) => ({ ...f, numberFormat: e.target.value }))}
            />
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button disabled={pending} onClick={handleSave}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
        {saved && <span className="text-xs text-[#4fd293]">Saved</span>}
        {error && <span className="text-xs text-[var(--status-hot)]">{error}</span>}
      </div>
    </div>
  );
}
