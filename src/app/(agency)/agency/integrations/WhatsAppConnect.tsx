"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { connectWhatsAppAction } from "@/lib/actions/agency-integrations";
import type { UiLanguage } from "@/lib/i18n";

/** Form to connect a real WhatsApp Business number. The access token is sent once to the server and never stored in the browser. */
export function WhatsAppConnect({
  lang,
  webhookUrl,
  serverReady,
  onDone,
}: {
  lang: UiLanguage;
  webhookUrl: string | null;
  serverReady: boolean;
  onDone: () => void;
}) {
  const ar = lang === "AR";
  const [open, setOpen] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();

  if (!open) {
    return (
      <Button className="mt-3 w-full" variant="primary" size="sm" onClick={() => setOpen(true)}>
        {ar ? "ربط رقم واتساب حقيقي" : "Connect a real WhatsApp number"}
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
        {ar ? "معرّف رقم الهاتف (Phone number ID)" : "Phone number ID"}
        <input
          className={inputClass}
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          inputMode="numeric"
          dir="ltr"
        />
      </label>
      <label className="block">
        {ar ? "رمز الوصول الدائم (System user token)" : "Permanent access token (system user)"}
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
          disabled={busy || !phoneNumberId.trim() || !accessToken.trim()}
          onClick={() =>
            startBusy(async () => {
              setError(null);
              const res = await connectWhatsAppAction({ phoneNumberId, accessToken });
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
