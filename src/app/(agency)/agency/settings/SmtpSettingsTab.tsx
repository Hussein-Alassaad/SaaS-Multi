"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { updateSmtpConfigAction, testSmtpConnectionAction } from "@/lib/actions/marketing-smtp";

export interface SmtpConfigView {
  host: string;
  port: number;
  username: string;
  useTls: boolean;
  fromEmail: string;
  fromName: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
}

interface FormState {
  host: string;
  port: string;
  username: string;
  password: string;
  useTls: boolean;
  fromEmail: string;
  fromName: string;
}

function toForm(config: SmtpConfigView | null): FormState {
  if (!config) return { host: "", port: "587", username: "", password: "", useTls: true, fromEmail: "", fromName: "" };
  return {
    host: config.host,
    port: String(config.port),
    username: config.username,
    password: "",
    useTls: config.useTls,
    fromEmail: config.fromEmail,
    fromName: config.fromName ?? "",
  };
}

export function SmtpSettingsTab({ config }: { config: SmtpConfigView | null }) {
  const router = useRouter();
  const [form, setForm] = useState(toForm(config));
  const [hasSavedConfig, setHasSavedConfig] = useState(config !== null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [testing, startTestTransition] = useTransition();

  const handleSave = () => {
    setSaved(false);
    setError(null);
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("Port must be a number between 1 and 65535.");
      return;
    }
    startTransition(async () => {
      const result = await updateSmtpConfigAction({
        host: form.host,
        port,
        username: form.username,
        password: form.password,
        useTls: form.useTls,
        fromEmail: form.fromEmail,
        fromName: form.fromName || null,
      });
      if (result.ok) {
        setSaved(true);
        setHasSavedConfig(true);
        setForm((f) => ({ ...f, password: "" }));
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  const handleTest = () => {
    setTestResult(null);
    startTestTransition(async () => {
      const result = await testSmtpConnectionAction();
      setTestResult(result.ok ? { ok: true, message: "Test email sent successfully." } : { ok: false, message: result.error });
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Card padding="md">
        <CardHeader>
          <div>
            <CardTitle>SMTP server</CardTitle>
            <CardDescription>Your own outbound mail server for sending campaigns.</CardDescription>
          </div>
          {config?.lastTestedAt && (
            <Badge variant={config.lastTestOk ? "success" : "hot"}>
              {config.lastTestOk ? "Last test succeeded" : "Last test failed"}
            </Badge>
          )}
        </CardHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Host</label>
            <Input
              placeholder="smtp.example.com"
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Port</label>
            <Input
              type="number"
              placeholder="587"
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">Username</label>
            <Input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">
              Password {hasSavedConfig && <span className="text-[var(--text-5)]">(leave blank to keep current)</span>}
            </label>
            <Input
              type="password"
              placeholder={hasSavedConfig ? "••••••••" : ""}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">From email</label>
            <Input
              type="email"
              placeholder="campaigns@acme.example.com"
              value={form.fromEmail}
              onChange={(e) => setForm((f) => ({ ...f, fromEmail: e.target.value }))}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[var(--text-3)]">From name</label>
            <Input
              placeholder="Acme Agency"
              value={form.fromName}
              onChange={(e) => setForm((f) => ({ ...f, fromName: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Toggle
              checked={form.useTls}
              onCheckedChange={(v) => setForm((f) => ({ ...f, useTls: v }))}
              label="Use TLS/SSL"
              description="Recommended for every SMTP provider."
            />
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={pending} onClick={handleSave}>
          {pending ? "Saving..." : "Save changes"}
        </Button>
        <Button variant="secondary" disabled={!hasSavedConfig || testing} onClick={handleTest}>
          {testing ? "Sending test..." : "Send test email"}
        </Button>
        {saved && <span className="text-xs text-[#4fd293]">Saved</span>}
        {error && <span className="text-xs text-[var(--status-hot)]">{error}</span>}
        {testResult && (
          <span className={`text-xs ${testResult.ok ? "text-[#4fd293]" : "text-[var(--status-hot)]"}`}>
            {testResult.message}
          </span>
        )}
      </div>
      {!hasSavedConfig && <p className="text-xs text-[var(--text-5)]">Save your SMTP settings once before sending a test email.</p>}
    </div>
  );
}
