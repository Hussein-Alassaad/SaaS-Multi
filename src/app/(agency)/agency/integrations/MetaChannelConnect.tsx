"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { connectMetaChannelAction } from "@/lib/actions/agency-integrations";
import type { UiLanguage } from "@/lib/i18n";

/** Form to connect a real Facebook Page or Instagram business account. The token is sent once to the server and never kept in the browser. */
export function MetaChannelConnect({
  provider,
  lang,
  webhookUrl,
  serverReady,
  onDone,
}: {
  provider: "INSTAGRAM" | "FACEBOOK";
  lang: UiLanguage;
  webhookUrl: string | null;
  serverReady: boolean;
  onDone: () => void;
}) {
  const ar = lang === "AR";
  const isFb = provider === "FACEBOOK";
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  if (!open) {
    return (
      <Button className="mt-3 w-full" variant="primary" size="sm" onClick={() => setOpen(true)}>
        {isFb ? (ar ? "ربط صفحة فيسبوك حقيقية" : "Connect a real Facebook Page") : ar ? "ربط حساب إنستغرام حقيقي" : "Connect a real Instagram account"}
      </Button>
    );
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-2 py-1.5 text-xs text-[var(--text-1)]";

  return (
    <div className="mt-3 space-y-2 text-xs text-[var(--text-3)]">
      {!serverReady && (
        <p className="text-[var(--status-hot)]">
          {ar
            ? "الخادم غير مهيأ بعد (META_APP_SECRET / WHATSAPP_VERIFY_TOKEN / APP_ENCRYPTION_KEY)."
            : "The server is not set up yet (META_APP_SECRET / WHATSAPP_VERIFY_TOKEN / APP_ENCRYPTION_KEY)."}
        </p>
      )}
      <label className="block">
        {isFb ? (ar ? "معرّف الصفحة (Page ID)" : "Page ID") : ar ? "معرّف حساب إنستغرام (Instagram account ID)" : "Instagram account ID"}
        <input className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)} inputMode="numeric" dir="ltr" />
      </label>
      <label className="block">
        {ar ? "رمز وصول الصفحة (Page access token)" : "Page access token"}
        <input
          className={inputClass}
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          type="password"
          autoComplete="off"
          dir="ltr"
        />
      </label>
      {webhookUrl && (
        <p className="break-all text-[10px] text-[var(--text-5)]">
          {ar ? "رابط الـ Webhook في تطبيق Meta:" : "Webhook URL to set in your Meta app:"} <span dir="ltr">{webhookUrl}</span>
        </p>
      )}
      {error && <p className="text-[var(--status-hot)]">{error}</p>}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy || !accountId.trim() || !accessToken.trim()}
          onClick={() =>
            startBusy(async () => {
              setError(null);
              const res = await connectMetaChannelAction({ provider, accountId, accessToken });
              if (res.ok) {
                setAccessToken("");
                setOpen(false);
                onDone();
              } else {
                setError(res.error);
              }
            })
          }
        >
          {busy ? (ar ? "جارٍ التحقق..." : "Checking...") : ar ? "تحقق واربط" : "Verify and connect"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
          {ar ? "إلغاء" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}
