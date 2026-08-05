"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";

export function ApiRequestsChart({ data }: { data: { date: string; requests: number; errors: number }[] }) {
  return (
    <ChartShell title="API Requests" description="Daily request volume & errors">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--text-5)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={6}
          />
          <YAxis tick={{ fill: "var(--text-5)", fontSize: 11 }} axisLine={false} tickLine={false} width={30} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="requests" name="Requests" fill="var(--accent-from)" radius={[4, 4, 0, 0]} maxBarSize={10} />
          <Bar dataKey="errors" name="Errors" fill="var(--status-hot)" radius={[4, 4, 0, 0]} maxBarSize={10} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
