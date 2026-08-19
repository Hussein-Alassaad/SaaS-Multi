"use client";

import { Card } from "./Card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: { value: string; positive: boolean };
  icon?: ReactNode;
  highlight?: boolean;
  className?: string;
  /** Optional trailing-bucket trend, rendered as a tiny inline SVG sparkline (no Recharts). */
  trend?: number[];
}

/**
 * Minimal inline sparkline: a plain SVG polyline, not a Recharts chart.
 * A tiny at-a-glance trend line doesn't need axes/tooltips/animation, and
 * avoids mounting a full chart per KPI card (this renders one per card,
 * up to 9 on the Analytics page).
 */
function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100;
  const h = 24;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-1.5 h-6 w-full" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent-from)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function KpiCard({ label, value, delta, icon, highlight, className, trend }: KpiCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)} padding="md">
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium text-[var(--text-4)] uppercase tracking-wide">
          {label}
        </span>
        {icon && (
          <div className="rounded-md p-1.5 bg-[var(--surface-2)] text-[var(--text-3)]">
            {icon}
          </div>
        )}
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight animate-kpi-in",
          highlight ? "text-gradient" : "text-[var(--text-1)]"
        )}
      >
        {value}
      </div>
      {delta && (
        <div
          className={cn(
            "mt-1.5 text-xs font-medium",
            delta.positive ? "text-[#4fd293]" : "text-[var(--status-hot)]"
          )}
        >
          {delta.positive ? "+" : ""}
          {delta.value}
        </div>
      )}
      {trend && <Sparkline data={trend} />}
    </Card>
  );
}
