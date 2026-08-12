"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";

export function ClientGrowthChart({ data }: { data: { date: string; clients: number }[] }) {
  return (
    <ChartShell title="Conversation Volume" description="Daily conversations, last 14 days">
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
            name="Clients"
            stroke="var(--accent-to)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
