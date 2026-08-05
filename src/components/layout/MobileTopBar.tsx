"use client";

import { Bell, Moon, Sun, LogOut } from "lucide-react";
import { useTheme } from "next-themes";

export function MobileTopBar() {
  const { theme, setTheme } = useTheme();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--surface-1)]/80 px-4 backdrop-blur-xl md:hidden">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-gradient text-xs font-bold text-white">
          A
        </div>
        <span className="text-sm font-semibold text-gradient">Admin Platform</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          aria-label="Notifications"
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--status-hot)]" />
        </button>
        <button
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          aria-label="Sign out"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
