"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";

export function RevenueChart({ data }: { data: { date: string; revenue: number }[] }) {
  return (
    <ChartShell title="Revenue Growth" description="Daily revenue, last 30 days">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-from)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent-from)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--text-5)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={6}
          />
          <YAxis tick={{ fill: "var(--text-5)", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="revenue"
            name="Revenue ($)"
            stroke="var(--accent-from)"
            strokeWidth={2}
            fill="url(#revenueFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
