"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { saveMeetingAvailabilityAction } from "@/lib/actions/agency-meetings";
import type { UiLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface Availability {
  enabled: boolean;
  days: number[];
  startHour: number;
  endHour: number;
  durationMin: number;
  horizonDays: number;
}

const DAY_NAMES = {
  EN: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  AR: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
};

/** Working hours the AI offers meetings in. Open slots are created from these automatically (in the business timezone from Settings > Localization). */
export function AvailabilityCard({ initial, timezone, lang }: { initial: Availability; timezone: string; lang: UiLanguage }) {
  const ar = lang === "AR";
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleDay = (d: number) =>
    setForm((f) => ({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] }));
  const num = "w-20 rounded-md border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-2 py-1 text-sm text-[var(--text-1)]";

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const res = await saveMeetingAvailabilityAction(form);
      if (res.ok) {
        setMessage({ ok: true, text: ar ? "تم الحفظ" : "Saved. New times are created as customers write in." });
        router.refresh();
      } else {
        setMessage({ ok: false, text: res.error });
      }
    });

  return (
    <Card padding="md">
      <CardHeader>
        <div>
          <CardTitle>{ar ? "ساعات العمل للاجتماعات" : "Meeting hours"}</CardTitle>
          <CardDescription>
            {ar
              ? `يعرض الذكاء الاصطناعي هذه الأوقات على الزبائن تلقائيًا. المنطقة الزمنية: ${timezone}`
              : `The AI offers these times to customers automatically. Timezone: ${timezone} (change it in Settings > Localization).`}
          </CardDescription>
        </div>
      </CardHeader>
      <div className="space-y-3 text-sm text-[var(--text-2)]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
          {ar ? "إنشاء الأوقات المتاحة تلقائيًا" : "Create open times automatically"}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {DAY_NAMES[ar ? "AR" : "EN"].map((name, d) => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs",
                form.days.includes(d)
                  ? "border-[var(--accent-from)] bg-[var(--surface-2)] text-[var(--text-1)]"
                  : "border-[var(--border-hairline)] text-[var(--text-4)]"
              )}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5">
            {ar ? "من" : "From"}
            <input className={num} type="number" min={0} max={23} value={form.startHour} onChange={(e) => setForm((f) => ({ ...f, startHour: Number(e.target.value) }))} />
            {ar ? "ساعة" : "h"}
          </label>
          <label className="flex items-center gap-1.5">
            {ar ? "إلى" : "to"}
            <input className={num} type="number" min={1} max={24} value={form.endHour} onChange={(e) => setForm((f) => ({ ...f, endHour: Number(e.target.value) }))} />
            {ar ? "ساعة" : "h"}
          </label>
          <label className="flex items-center gap-1.5">
            {ar ? "مدة الاجتماع (دقيقة)" : "Meeting length (min)"}
            <input className={num} type="number" min={15} max={240} step={15} value={form.durationMin} onChange={(e) => setForm((f) => ({ ...f, durationMin: Number(e.target.value) }))} />
          </label>
          <label className="flex items-center gap-1.5">
            {ar ? "أيام مقدمًا" : "Days ahead"}
            <input className={num} type="number" min={1} max={30} value={form.horizonDays} onChange={(e) => setForm((f) => ({ ...f, horizonDays: Number(e.target.value) }))} />
          </label>
        </div>
        {message && <p className={cn("text-xs", message.ok ? "text-[var(--text-4)]" : "text-[var(--status-hot)]")}>{message.text}</p>}
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? (ar ? "جارٍ الحفظ..." : "Saving...") : ar ? "حفظ" : "Save"}
        </Button>
      </div>
    </Card>
  );
}
