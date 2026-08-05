"use client";

import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";

export function TenantGrowthChart({ data }: { data: { date: string; tenants: number }[] }) {
  return (
    <ChartShell title="Tenant Growth" description="Cumulative tenants, last 30 days">
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
            dataKey="tenants"
            name="Tenants"
            stroke="var(--accent-to)"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
