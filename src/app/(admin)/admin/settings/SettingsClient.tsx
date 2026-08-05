"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";

export function SettingsClient() {
  const [companyName, setCompanyName] = useState("Admin Platform Inc.");
  const [supportEmail, setSupportEmail] = useState("support@example.com");
  const [timezone, setTimezone] = useState("UTC");
  const [locale, setLocale] = useState("en-US");
  const [smtpHost, setSmtpHost] = useState("smtp.postmarkapp.com");
  const [smtpPort, setSmtpPort] = useState("587");
  const [maintenanceBanner, setMaintenanceBanner] = useState(false);
  const [allowSignups, setAllowSignups] = useState(true);

  return (
    <Tabs defaultValue="company">
      <TabsList>
        <TabsTrigger value="company">Company</TabsTrigger>
        <TabsTrigger value="brand">Brand</TabsTrigger>
        <TabsTrigger value="smtp">SMTP</TabsTrigger>
        <TabsTrigger value="localization">Localization</TabsTrigger>
        <TabsTrigger value="advanced">Advanced</TabsTrigger>
      </TabsList>

      <TabsContent value="company">
        <Card>
          <CardHeader>
            <CardTitle>Company Details</CardTitle>
            <CardDescription>Basic information about your organization</CardDescription>
          </CardHeader>
          <div className="space-y-4 max-w-md">
            <Field label="Company Name">
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </Field>
            <Field label="Support Email">
              <Input value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} type="email" />
            </Field>
            <div className="flex justify-end">
              <Button>Save Changes</Button>
            </div>
          </div>
        </Card>
      </TabsContent>

      <TabsContent value="brand">
        <Card>
          <CardHeader>
            <CardTitle>Brand</CardTitle>
            <CardDescription>Logo, colors, and visual identity for tenant-facing surfaces</CardDescription>
          </CardHeader>
          <div className="space-y-4 max-w-md">
            <Field label="Primary Color">
              <div className="flex items-center gap-2">
                <div className="h-9 w-9 rounded-lg bg-accent-gradient" />
                <Input defaultValue="#7c5cff" />
              </div>
            </Field>
            <Field label="Logo URL">
              <Input placeholder="https://cdn.example.com/logo.svg" />
            </Field>
          </div>
        </Card>
      </TabsContent>

      <TabsContent value="smtp">
        <Card>
          <CardHeader>
            <CardTitle>SMTP Configuration</CardTitle>
            <CardDescription>Outbound transactional email settings</CardDescription>
          </CardHeader>
          <div className="grid grid-cols-1 gap-4 max-w-md sm:grid-cols-2">
            <Field label="Host">
              <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
            </Field>
            <Field label="Port">
              <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
            </Field>
          </div>
        </Card>
      </TabsContent>

      <TabsContent value="localization">
        <Card>
          <CardHeader>
            <CardTitle>Localization</CardTitle>
            <CardDescription>Default timezone and locale for new tenants</CardDescription>
          </CardHeader>
          <div className="grid grid-cols-1 gap-4 max-w-md sm:grid-cols-2">
            <Field label="Timezone">
              <Select
                value={timezone}
                onValueChange={setTimezone}
                options={[
                  { value: "UTC", label: "UTC" },
                  { value: "America/New_York", label: "America/New_York" },
                  { value: "Europe/London", label: "Europe/London" },
                  { value: "Asia/Dubai", label: "Asia/Dubai" },
                ]}
              />
            </Field>
            <Field label="Locale">
              <Select
                value={locale}
                onValueChange={setLocale}
                options={[
                  { value: "en-US", label: "English (US)" },
                  { value: "en-GB", label: "English (UK)" },
                  { value: "fr-FR", label: "French" },
                  { value: "ar-AE", label: "Arabic" },
                ]}
              />
            </Field>
          </div>
        </Card>
      </TabsContent>

      <TabsContent value="advanced">
        <Card>
          <CardHeader>
            <CardTitle>Advanced</CardTitle>
            <CardDescription>Platform-wide operational toggles</CardDescription>
          </CardHeader>
          <div className="space-y-4">
            <Toggle
              checked={maintenanceBanner}
              onCheckedChange={setMaintenanceBanner}
              label="Show Maintenance Banner"
              description="Displays a dismissible banner to all tenant users"
            />
            <Toggle
              checked={allowSignups}
              onCheckedChange={setAllowSignups}
              label="Allow New Tenant Signups"
              description="Disable to pause onboarding of new tenants platform-wide"
            />
          </div>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-[var(--text-1)]">{label}</label>
      {children}
    </div>
  );
}
