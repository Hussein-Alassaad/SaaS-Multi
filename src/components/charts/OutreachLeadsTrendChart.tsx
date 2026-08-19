"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";

export function OutreachLeadsTrendChart({
  data,
  title,
}: {
  data: { date: string; leads: number }[];
  title: string;
}) {
  return (
    <ChartShell title={title} description="Leads discovered, bucketed over the selected range.">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="outreachLeadsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-from)" stopOpacity={0.5} />
              <stop offset="100%" stopColor="var(--accent-from)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hairline)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "var(--text-5)", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: "var(--text-5)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            width={28}
          />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="leads"
            name="Leads"
            stroke="var(--accent-from)"
            strokeWidth={2}
            fill="url(#outreachLeadsFill)"
            animationDuration={900}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartShell>
  );
}
