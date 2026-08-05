"use client";

import { motion } from "framer-motion";
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
}

export function KpiCard({ label, value, delta, icon, highlight, className }: KpiCardProps) {
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
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className={cn(
          "mt-2 text-2xl font-semibold tracking-tight",
          highlight ? "text-gradient" : "text-[var(--text-1)]"
        )}
      >
        {value}
      </motion.div>
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
    </Card>
  );
}
