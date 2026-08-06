"use client";

import { Bell, Moon, Sun, LogOut } from "lucide-react";
import { useTheme } from "next-themes";
import { logoutAction } from "@/lib/actions/auth";
import { useHasMounted } from "@/lib/useHasMounted";

interface CurrentUser {
  name: string;
  role: string;
}

export function MobileTopBar({ currentUser }: { currentUser: CurrentUser | null }) {
  const { theme, setTheme } = useTheme();
  const mounted = useHasMounted();
  const initial = currentUser?.name?.trim()?.[0]?.toUpperCase() ?? "A";

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--surface-1)]/80 px-4 backdrop-blur-xl md:hidden">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-gradient text-xs font-bold text-white">
          {initial}
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
          {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <form action={logoutAction}>
          <button
            type="submit"
            aria-label="Sign out"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
