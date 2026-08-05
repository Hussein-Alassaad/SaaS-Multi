import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium leading-none border",
  {
    variants: {
      variant: {
        neutral: "bg-[var(--surface-2)] text-[var(--text-2)] border-[var(--border-hairline)]",
        accent:
          "text-[var(--text-1)] border-[color-mix(in_oklab,var(--accent-from)_30%,transparent)] bg-[linear-gradient(90deg,color-mix(in_oklab,var(--accent-from)_20%,transparent),color-mix(in_oklab,var(--accent-to)_10%,transparent))]",
        hot: "bg-[color-mix(in_oklab,var(--status-hot)_16%,transparent)] text-[var(--status-hot)] border-[color-mix(in_oklab,var(--status-hot)_30%,transparent)]",
        warm: "bg-[color-mix(in_oklab,var(--status-warm)_16%,transparent)] text-[var(--status-warm)] border-[color-mix(in_oklab,var(--status-warm)_30%,transparent)]",
        cold: "bg-[color-mix(in_oklab,var(--status-cold)_16%,transparent)] text-[var(--status-cold)] border-[color-mix(in_oklab,var(--status-cold)_30%,transparent)]",
        success:
          "bg-[color-mix(in_oklab,#4fd293_16%,transparent)] text-[#3fb87e] border-[color-mix(in_oklab,#4fd293_30%,transparent)]",
        outline: "bg-transparent text-[var(--text-3)] border-[var(--border-hairline-strong)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
