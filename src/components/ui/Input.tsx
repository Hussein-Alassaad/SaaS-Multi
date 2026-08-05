import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-9 w-full rounded-lg border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] px-3 text-sm text-[var(--text-1)] placeholder:text-[var(--text-5)] outline-none transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]",
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
