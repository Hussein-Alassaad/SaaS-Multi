"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";
import { getDictionary, isRtl, type UiLanguage } from "@/lib/i18n";

const COLORS = [
  "var(--accent-from)",
  "var(--accent-to)",
  "var(--status-warm)",
  "var(--status-cold)",
  "var(--accent-from)",
  "#4fd293",
  "var(--status-hot)",
];

export function LeadStageChart({ data, lang }: { data: { stage: string; count: number }[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  const rtl = isRtl(lang);
  const translated = data.map((d) => ({
    ...d,
    stage: t.stage[d.stage as keyof typeof t.stage] ?? d.stage,
  }));

  return (
    <ChartShell title={t.analytics.leadsByStage} description={t.analytics.leadsByStageSubtitle}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={translated}
          layout="vertical"
          margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
          reverseStackOrder={rtl}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "var(--text-5)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            orientation={rtl ? "top" : "bottom"}
            reversed={rtl}
          />
          <YAxis
            type="category"
            dataKey="stage"
            tick={{ fill: "var(--text-3)", fontSize: 11, textAnchor: rtl ? "start" : "end" }}
            axisLine={false}
            tickLine={false}
            orientation={rtl ? "right" : "left"}
            width={110}
            mirror={rtl}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="count" name={t.analytics.leads} radius={rtl ? [4, 0, 0, 4] : [0, 4, 4, 0]} maxBarSize={20}>
            {translated.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
