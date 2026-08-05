"use client";

import * as Switch from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ checked, onCheckedChange, label, description, disabled, className }: ToggleProps) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      {(label || description) && (
        <div>
          {label && <div className="text-sm font-medium text-[var(--text-1)]">{label}</div>}
          {description && <div className="text-xs text-[var(--text-4)] mt-0.5">{description}</div>}
        </div>
      )}
      <Switch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 outline-none",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]",
          checked ? "bg-accent-gradient" : "bg-[var(--surface-3)]",
          disabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <Switch.Thumb
          className={cn(
            "block h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 translate-x-0.5",
            checked && "translate-x-[22px]"
          )}
        />
      </Switch.Root>
    </div>
  );
}
