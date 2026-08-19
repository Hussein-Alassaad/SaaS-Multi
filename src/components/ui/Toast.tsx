"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { X, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error";

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_ICON: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  error: AlertTriangle,
};

const VARIANT_COLOR: Record<ToastVariant, string> = {
  default: "text-[var(--accent-from)]",
  success: "text-[#4fd293]",
  error: "text-[var(--status-hot)]",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastPrimitive.Provider swipeDirection="right" duration={5000}>
        <AnimatePresence>
          {toasts.map((toast) => {
            const Icon = VARIANT_ICON[toast.variant];
            return (
              <ToastPrimitive.Root
                key={toast.id}
                asChild
                forceMount
                onOpenChange={(open) => !open && dismiss(toast.id)}
              >
                <motion.div
                  className="glass pointer-events-auto flex w-80 items-start gap-2.5 p-3.5 shadow-lg"
                  initial={{ opacity: 0, y: 24, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 40, scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                >
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", VARIANT_COLOR[toast.variant])} />
                  <div className="min-w-0 flex-1">
                    <ToastPrimitive.Title className="text-sm font-medium text-[var(--text-1)]">
                      {toast.title}
                    </ToastPrimitive.Title>
                    {toast.description && (
                      <ToastPrimitive.Description className="mt-0.5 text-xs text-[var(--text-4)]">
                        {toast.description}
                      </ToastPrimitive.Description>
                    )}
                  </div>
                  <ToastPrimitive.Close
                    className="shrink-0 rounded-md p-0.5 text-[var(--text-5)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                    aria-label="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </ToastPrimitive.Close>
                </motion.div>
              </ToastPrimitive.Root>
            );
          })}
        </AnimatePresence>
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
