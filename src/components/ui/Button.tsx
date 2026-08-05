"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-from)]",
  {
    variants: {
      variant: {
        primary:
          "text-white bg-[var(--accent-from)] bg-accent-gradient shadow-[0_0_0_1px_rgba(255,255,255,0.06)] hover:brightness-110 active:brightness-95",
        secondary:
          "bg-[var(--surface-2)] text-[var(--text-1)] border border-[var(--border-hairline)] hover:bg-[var(--surface-3)]",
        ghost: "text-[var(--text-2)] hover:bg-[var(--surface-2)]",
        outline:
          "border border-[var(--border-hairline-strong)] text-[var(--text-2)] hover:bg-[var(--surface-2)]",
        destructive: "bg-[var(--status-hot)] text-white hover:brightness-110",
        link: "text-[var(--accent-from)] underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  }
);
Button.displayName = "Button";
