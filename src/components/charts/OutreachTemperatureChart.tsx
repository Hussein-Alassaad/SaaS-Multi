"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartShell, ChartTooltip } from "./ChartShell";

const TEMP_COLORS: Record<string, string> = {
  hot: "var(--status-hot)",
  warm: "var(--status-warm)",
  cold: "var(--status-cold)",
};

export function OutreachTemperatureChart({
  data,
  total,
}: {
  data: { name: string; value: number; key: "hot" | "warm" | "cold" }[];
  total: number;
}) {
  return (
    <ChartShell title="Temperature breakdown" description="Hot, warm, and cold leads by AI score.">
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-[var(--text-5)]">
          No scored leads yet
        </div>
      ) : (
        <div className="relative h-full">
          {/* Total sits in the donut's own hole instead of an on-slice label,
              which has nowhere to go for a single 100%-share slice (e.g. a
              board with only "hot" leads so far). */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-semibold tabular-nums text-[var(--text-1)]">{total}</span>
            <span className="text-[11px] text-[var(--text-5)]">scored</span>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={3}
                animationDuration={900}
              >
                {data.map((entry) => (
                  <Cell key={entry.key} fill={TEMP_COLORS[entry.key]} stroke="none" />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
              <Legend
                verticalAlign="bottom"
                height={24}
                iconType="circle"
                iconSize={8}
                formatter={(value) => <span className="text-xs text-[var(--text-4)]">{value}</span>}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartShell>
  );
}
