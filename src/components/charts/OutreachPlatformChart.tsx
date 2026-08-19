"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";

export function OutreachPlatformChart({ data }: { data: { name: string; leads: number }[] }) {
  return (
    <ChartShell title="Leads by platform" description="LinkedIn, Instagram, and Email discovery volume.">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: "var(--text-5)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: "var(--text-5)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            width={28}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey="leads" name="Leads" fill="var(--accent-from)" radius={[6, 6, 0, 0]} maxBarSize={64} animationDuration={900} />
        </BarChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
