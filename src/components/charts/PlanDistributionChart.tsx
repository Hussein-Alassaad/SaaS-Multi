"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";

const COLORS = ["var(--accent-from)", "var(--accent-to)", "var(--status-warm)"];

export function PlanDistributionChart({ data }: { data: { name: string; count: number }[] }) {
  return (
    <ChartShell title="Plan Distribution" description="Active subscriptions by plan">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" horizontal={false} />
          <XAxis type="number" tick={{ fill: "var(--text-5)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fill: "var(--text-3)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={80}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="count" name="Subscriptions" radius={[0, 4, 4, 0]} maxBarSize={24}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
