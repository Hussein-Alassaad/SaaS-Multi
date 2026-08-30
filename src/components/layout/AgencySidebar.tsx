"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useState, useTransition } from "react";
import { AGENCY_NAV_ITEMS } from "./agency-nav-config";
import { LogOut, Moon, Sun, Languages } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useHasMounted } from "@/lib/useHasMounted";
import { logoutAction } from "@/lib/actions/auth";
import { setUiLanguageAction } from "@/lib/actions/agency-ui-language";
import { getDictionary, isRtl, type UiLanguage } from "@/lib/i18n";
import { NexarisLogo } from "./NexarisLogo";
import { SidebarExpandedLabel } from "./SidebarExpandedLabel";

interface CurrentUser {
  name: string;
  role: string;
}

export function AgencySidebar({
  currentUser,
  lang,
  enabledSections,
}: {
  currentUser: CurrentUser | null;
  lang: UiLanguage;
  enabledSections: string[];
}) {
  const enabledSet = new Set(enabledSections);
  const visibleNavItems = AGENCY_NAV_ITEMS.filter((item) => enabledSet.has(item.href));
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const { theme, setTheme } = useTheme();
  const mounted = useHasMounted();
  const [, startTransition] = useTransition();
  const initial = currentUser?.name?.trim()?.[0]?.toUpperCase() ?? "A";
  const t = getDictionary(lang);
  const rtl = isRtl(lang);

  const isActive = (href: string) =>
    href === "/agency" ? pathname === "/agency" : pathname.startsWith(href);

  const navLabel = (href: string, fallback: string) => {
    const key = href.replace("/agency", "").replace(/^\//, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase()) || "dashboard";
    const map: Record<string, string> = {
      dashboard: t.nav.dashboard,
      inbox: t.nav.inbox,
      aiControl: t.nav.aiControl,
      pipeline: t.nav.pipeline,
      approvals: t.nav.approvals,
      clients: t.nav.clients,
      meetings: t.nav.meetings,
      knowledgeBase: t.nav.knowledgeBase,
      integrations: t.nav.integrations,
      analytics: t.nav.analytics,
      featureRequests: t.nav.featureRequests,
      team: t.nav.team,
      settings: t.nav.settings,
    };
    return map[key] ?? fallback;
  };

  const handleToggleLanguage = () => {
    startTransition(async () => {
      await setUiLanguageAction(lang === "AR" ? "EN" : "AR");
      router.refresh();
    });
  };

  return (
    <motion.aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      animate={{ width: expanded ? 224 : 64 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className={cn(
        "fixed top-0 z-40 hidden h-screen flex-col border-[var(--border-hairline)] bg-[var(--surface-1)]/80 backdrop-blur-xl md:flex",
        rtl ? "right-0 border-l" : "left-0 border-r"
      )}
    >
      <div className="flex h-16 items-center px-4">
        <NexarisLogo />
        <SidebarExpandedLabel expanded={expanded} className="ms-3 text-sm font-semibold text-gradient whitespace-nowrap">
          Nexaris
        </SidebarExpandedLabel>
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
                  layoutId="agency-active-nav-pill"
                  className="absolute inset-0 rounded-lg ring-1 ring-[color-mix(in_oklab,var(--accent-from)_30%,transparent)]"
                  style={{
                    background:
                      "linear-gradient(90deg, color-mix(in oklab, var(--accent-from) 20%, transparent), color-mix(in oklab, var(--accent-to) 10%, transparent))",
                  }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                />
              )}
              <Icon
                className={cn(
                  "relative z-10 h-4.5 w-4.5 shrink-0",
                  active ? "text-[var(--text-1)]" : "text-[var(--text-4)]"
                )}
              />
              <SidebarExpandedLabel
                expanded={expanded}
                className={cn(
                  "relative z-10 ms-3 whitespace-nowrap",
                  active ? "text-[var(--text-1)] font-medium" : "text-[var(--text-3)]"
                )}
              >
                {navLabel(item.href, item.label)}
              </SidebarExpandedLabel>
            </Link>
          );
        })}
      </nav>

      {currentUser && (
        <div className="flex items-center border-t border-[var(--border-hairline)] px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--surface-3)] text-xs font-semibold text-[var(--text-2)]">
            {initial}
          </div>
          <SidebarExpandedLabel expanded={expanded} as="div" className="ms-3 min-w-0">
            <p className="truncate text-xs font-medium text-[var(--text-1)]">{currentUser.name}</p>
            <p className="truncate text-[11px] text-[var(--text-4)]">{currentUser.role}</p>
          </SidebarExpandedLabel>
        </div>
      )}

      <div className="space-y-1 border-t border-[var(--border-hairline)] px-2 py-3">
        <button
          onClick={handleToggleLanguage}
          className="flex h-10 w-full items-center rounded-lg px-2.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]"
        >
          <Languages className="h-4.5 w-4.5 shrink-0" />
          <SidebarExpandedLabel expanded={expanded} className="ms-3 whitespace-nowrap">
            {t.common.toggleLanguage}
          </SidebarExpandedLabel>
        </button>
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-10 w-full items-center rounded-lg px-2.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]"
        >
          {mounted && theme === "dark" ? (
            <Sun className="h-4.5 w-4.5 shrink-0" />
          ) : (
            <Moon className="h-4.5 w-4.5 shrink-0" />
          )}
          <SidebarExpandedLabel expanded={expanded} className="ms-3 whitespace-nowrap">
            {t.common.toggleTheme}
          </SidebarExpandedLabel>
        </button>
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex h-10 w-full items-center rounded-lg px-2.5 text-[var(--text-3)] hover:bg-[var(--surface-2)]"
          >
            <LogOut className="h-4.5 w-4.5 shrink-0" />
            <SidebarExpandedLabel expanded={expanded} className="ms-3 whitespace-nowrap">
              {t.common.signOut}
            </SidebarExpandedLabel>
          </button>
        </form>
      </div>
    </motion.aside>
  );
}
