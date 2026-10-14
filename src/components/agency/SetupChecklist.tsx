import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import type { SetupItem } from "@/lib/agency/setup";
import { MIN_KNOWLEDGE_ENTRIES } from "@/lib/agency/setup";
import type { UiLanguage } from "@/lib/i18n";

const TEXT: Record<string, { en: [string, string]; ar: [string, string] }> = {
  timezone: {
    en: ["Set your timezone", "Every meeting time the AI quotes comes from it. Settings > Localization."],
    ar: ["حدد المنطقة الزمنية", "كل موعد يذكره الذكاء الاصطناعي يعتمد عليها. الإعدادات > اللغة والمنطقة."],
  },
  knowledge: {
    en: [`Teach the AI (at least ${MIN_KNOWLEDGE_ENTRIES} Knowledge Base entries)`, "What you sell, prices, hours, location, common questions. It only answers from these."],
    ar: [`علّم الذكاء الاصطناعي (${MIN_KNOWLEDGE_ENTRIES} إدخالات على الأقل)`, "ما تبيعه، الأسعار، الدوام، الموقع، الأسئلة الشائعة. يجيب منها فقط."],
  },
  hours: {
    en: ["Set your meeting hours", "Days and hours the AI can offer for a phone call."],
    ar: ["حدد ساعات الاجتماعات", "الأيام والساعات التي يعرضها الذكاء الاصطناعي لمكالمة."],
  },
  server: {
    en: ["Server settings on Vercel", "The keys and secrets the AI needs (set once, not per workspace)."],
    ar: ["إعدادات الخادم على Vercel", "المفاتيح والأسرار التي يحتاجها الذكاء الاصطناعي (مرة واحدة)."],
  },
  channel: {
    en: ["Connect WhatsApp, Instagram or Facebook", "Paste the ID and token from your Meta app in Integrations."],
    ar: ["اربط واتساب أو إنستغرام أو فيسبوك", "الصق المعرّف والرمز من تطبيق Meta في التكاملات."],
  },
  firstChat: {
    en: ["Get your first real conversation", "Message the connected number from a test account and watch it appear in the Live Inbox."],
    ar: ["احصل على أول محادثة حقيقية", "راسل الرقم المرتبط من حساب تجريبي وشاهدها تظهر في صندوق الوارد."],
  },
};

/** Shown on the dashboard until every step is done, so it is always clear what is still missing before the AI can reply for real. */
export function SetupChecklist({ items, lang }: { items: SetupItem[]; lang: UiLanguage }) {
  const ar = lang === "AR";
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;

  return (
    <Card padding="md">
      <CardHeader>
        <div>
          <CardTitle>{ar ? `جاهزية الذكاء الاصطناعي: ${done} من ${items.length}` : `Getting the AI ready: ${done} of ${items.length} done`}</CardTitle>
          <CardDescription>
            {ar ? "أكمل هذه الخطوات ليبدأ الذكاء الاصطناعي بالرد على زبائنك." : "Finish these and the AI can start answering your customers."}
          </CardDescription>
        </div>
      </CardHeader>
      <ul className="space-y-2.5">
        {items.map((item) => {
          const [title, hint] = ar ? TEXT[item.key].ar : TEXT[item.key].en;
          return (
            <li key={item.key} className="flex items-start gap-2.5">
              {item.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-cold)]" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-5)]" />
              )}
              <div className="min-w-0">
                <Link href={item.href} className={item.done ? "text-sm text-[var(--text-4)] line-through" : "text-sm font-medium text-[var(--text-1)] hover:underline"}>
                  {title}
                </Link>
                {!item.done && <p className="text-xs text-[var(--text-4)]">{hint}</p>}
                {!item.done && item.missing && item.missing.length > 0 && (
                  <p className="mt-0.5 text-[11px] text-[var(--text-5)]" dir="ltr">
                    {ar ? "ناقص: " : "Missing: "}
                    {item.missing.join(", ")}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
