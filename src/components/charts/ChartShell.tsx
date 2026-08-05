"use client";

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import type { ReactNode } from "react";

interface ChartShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  action?: ReactNode;
}

export function ChartShell({ title, description, children, action }: ChartShellProps) {
  return (
    <Card padding="md" className="h-full">
      <CardHeader>
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <div className="h-64 w-full">{children}</div>
    </Card>
  );
}

/** Shared tooltip content styled to match the glass design system. */
export function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass px-3 py-2 text-xs" style={{ backdropFilter: "blur(20px)" }}>
      <div className="mb-1 font-medium text-[var(--text-2)]">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-[var(--text-3)]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
          <span>{p.name}:</span>
          <span className="font-medium text-[var(--text-1)]">{p.value}</span>
        </div>
      ))}
    </div>
  );
}
