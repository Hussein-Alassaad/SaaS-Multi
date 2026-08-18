"use client";

import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddings = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

// Plain div, not motion.div: the hover-lift effect is handled entirely by
// the .glass-hover CSS class (see globals.css), and no motion props
// (initial/animate/etc.) were ever used here -- framer-motion was dead
// weight on every page that renders a Card (i.e. all of them).
export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, hover = true, padding = "md", children, ...props }, ref) => {
    return (
      <div ref={ref} className={cn("glass", hover && "glass-hover", paddings[padding], className)} {...props}>
        {children}
      </div>
    );
  }
);
Card.displayName = "Card";

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex items-center justify-between mb-4", className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={cn("text-sm font-semibold text-[var(--text-1)]", className)}>{children}</h3>;
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-xs text-[var(--text-4)] mt-1", className)}>{children}</p>;
}
