"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";
import { getDictionary, type UiLanguage } from "@/lib/i18n";

export function ClientGrowthChart({ data, lang }: { data: { date: string; clients: number }[]; lang: UiLanguage }) {
  const t = getDictionary(lang);
  return (
    <ChartShell title={t.analytics.conversationVolume} description={t.analytics.conversationVolumeSubtitle}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--text-5)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={6}
          />
          <YAxis tick={{ fill: "var(--text-5)", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
          <Tooltip content={<ChartTooltip />} />
          <Line
            type="monotone"
            dataKey="clients"
            name={t.analytics.conversations}
            stroke="var(--accent-to)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
