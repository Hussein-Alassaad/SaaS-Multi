"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useState } from "react";
import { OUTREACH_NAV_ITEMS } from "./outreach-nav-config";
import { LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useHasMounted } from "@/lib/useHasMounted";
import { logoutAction } from "@/lib/actions/auth";

interface CurrentUser {
  name: string;
  role: string;
}

export function OutreachSidebar({
  currentUser,
  enabledSections,
}: {
  currentUser: CurrentUser | null;
  enabledSections: string[];
}) {
  const enabledSet = new Set(enabledSections);
  const visibleNavItems = OUTREACH_NAV_ITEMS.filter((item) => enabledSet.has(item.href));
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const { theme, setTheme } = useTheme();
  const mounted = useHasMounted();
  const initial = currentUser?.name?.trim()?.[0]?.toUpperCase() ?? "O";

  const isActive = (href: string) => (href === "/outreach" ? pathname === "/outreach" : pathname.startsWith(href));

  return (
    <motion.aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      animate={{ width: expanded ? 224 : 64 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-[var(--border-hairline)] bg-[var(--surface-1)]/80 backdrop-blur-xl md:flex"
    >
      <div className="flex h-16 items-center px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-gradient text-sm font-bold text-white">
          {initial}
        </div>
        {expanded && <span className="ms-3 text-sm font-semibold text-gradient whitespace-nowrap">Outreach</span>}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
        {visibleNavItems.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative flex h-10 items-center rounded-lg px-2.5 text-sm transition-colors"
            >
              {active && (
                <motion.div
                  layoutId="outreach-active-nav-pill"
                  className="absolute inset-0 rounded-lg ring-1 ring-[color-mix(in_oklab,var(--accent-from)_30%,transparent)]"
                  style={{
                    background:
                      "linear-gradient(90deg, color-mix(in oklab, var(--accent-from) 20%, transparent), color-mix(in oklab, var(--accent-to) 10%, transparent))",
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <Icon
                className={cn(
                  "relative z-10 h-4.5 w-4.5 shrink-0",
                  active ? "text-[var(--text-1)]" : "text-[var(--text-4)]"
                )}
              />
              {expanded && (
                <span
                  className={cn(
                    "relative z-10 ms-3 whitespace-nowrap",
                    active ? "text-[var(--text-1)] font-medium" : "text-[var(--text-3)]"
                  )}
                >
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {currentUser && (
        <div className="flex items-center border-t border-[var(--border-hairline)] px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)] text-xs font-semibold text-[var(--text-2)]">
            {initial}
          </div>
          {expanded && (
            <div className="ms-3 min-w-0">
              <p className="truncate text-xs font-medium text-[var(--text-1)]">{currentUser.name}</p>
              <p className="truncate text-[11px] text-[var(--text-4)]">{currentUser.role}</p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1 border-t border-[var(--border-hairline)] px-2 py-3">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-10 w-full items-center rounded-lg px-2.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]"
        >
          {mounted && theme === "dark" ? (
            <Sun className="h-4.5 w-4.5 shrink-0" />
          ) : (
            <Moon className="h-4.5 w-4.5 shrink-0" />
          )}
          {expanded && <span className="ms-3 whitespace-nowrap">Toggle theme</span>}
        </button>
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex h-10 w-full items-center rounded-lg px-2.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]"
          >
            <LogOut className="h-4.5 w-4.5 shrink-0" />
            {expanded && <span className="ms-3 whitespace-nowrap">Sign out</span>}
          </button>
        </form>
      </div>
    </motion.aside>
  );
}
