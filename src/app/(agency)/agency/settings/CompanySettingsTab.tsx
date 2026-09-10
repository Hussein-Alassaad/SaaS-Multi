"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateCompanySettingsAction } from "@/lib/actions/marketing-settings";

export interface CompanySettingsForm {
  companyName: string;
  logoUrl: string;
  website: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  senderName: string;
  emailSignature: string;
  voiceTone: string;
}

const EMPTY: CompanySettingsForm = {
  companyName: "",
  logoUrl: "",
  website: "",
  primaryColor: "",
  secondaryColor: "",
  fontFamily: "",
  senderName: "",
  emailSignature: "",
  voiceTone: "",
};

export function CompanySettingsTab({ settings }: { settings: CompanySettingsForm | null }) {
  const router = useRouter();
  const [form, setForm] = useState(settings ?? EMPTY);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const field = (key: keyof CompanySettingsForm) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const handleSave = () => {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await updateCompanySettingsAction(form);
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
            <CardTitle>Company details</CardTitle>
            <CardDescription>Your business name, logo, and website, shown across the dashboard.</CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Company name</label>
            <Input placeholder="Acme Agency" {...field("companyName")} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Website</label>
            <Input placeholder="https://acme.example.com" {...field("website")} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Logo URL</label>
            <Input placeholder="https://.../logo.png" {...field("logoUrl")} />
          </div>
        </div>
      </Card>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>Brand</CardTitle>
            <CardDescription>Colors and font used in customer-facing brand materials.</CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Primary color</label>
            <Input placeholder="#7C5CFC" {...field("primaryColor")} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Secondary color</label>
            <Input placeholder="#22D3EE" {...field("secondaryColor")} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Font family</label>
            <Input placeholder="Inter" {...field("fontFamily")} />
          </div>
        </div>
      </Card>

      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>Email identity</CardTitle>
            <CardDescription>Sender display name and signature used on outgoing email.</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Sender display name</label>
            <Input placeholder="Acme Agency Team" {...field("senderName")} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Email signature</label>
            <textarea
              value={form.emailSignature}
              onChange={(e) => setForm((f) => ({ ...f, emailSignature: e.target.value }))}
              placeholder="Best,&#10;The Acme Team"
              rows={4}
              className="flex w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Brand voice & tone guidance</label>
            <textarea
              value={form.voiceTone}
              onChange={(e) => setForm((f) => ({ ...f, voiceTone: e.target.value }))}
              placeholder="Warm, direct, no jargon..."
              rows={4}
              className="flex w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 py-2 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] outline-none"
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
