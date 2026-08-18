"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useState } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { AGENCY_NAV_ITEMS } from "./agency-nav-config";
import { cn } from "@/lib/utils";
import { getDictionary, type UiLanguage } from "@/lib/i18n";

const NAV_KEY_MAP: Record<string, keyof ReturnType<typeof getDictionary>["nav"]> = {
  "/agency": "dashboard",
  "/agency/inbox": "inbox",
  "/agency/ai-control": "aiControl",
  "/agency/pipeline": "pipeline",
  "/agency/approvals": "approvals",
  "/agency/clients": "clients",
  "/agency/meetings": "meetings",
  "/agency/knowledge-base": "knowledgeBase",
  "/agency/integrations": "integrations",
  "/agency/analytics": "analytics",
  "/agency/feature-requests": "featureRequests",
  "/agency/team": "team",
  "/agency/settings": "settings",
};

export function AgencyMobileBottomBar({ lang, enabledSections }: { lang: UiLanguage; enabledSections: string[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const t = getDictionary(lang);
  const enabledSet = new Set(enabledSections);
  const visibleNavItems = AGENCY_NAV_ITEMS.filter((item) => enabledSet.has(item.href));

  const label = (href: string, fallback: string) => {
    const key = NAV_KEY_MAP[href];
    return key ? t.nav[key] : fallback;
  };

  const current = visibleNavItems.find((n) =>
    n.href === "/agency" ? pathname === "/agency" : pathname.startsWith(n.href)
  );

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-between border-t border-[var(--border-hairline)] bg-[var(--surface-1)]/90 px-4 backdrop-blur-xl md:hidden">
        <span className="text-sm font-medium text-[var(--text-2)]">
          {current ? label(current.href, current.label) : t.common.workspaceName}
        </span>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-[var(--text-1)]"
        >
          <Menu className="h-3.5 w-3.5" />
          {t.common.menu}
        </button>
      </nav>

      <Drawer open={open} onOpenChange={setOpen} title={t.common.navigate}>
        <div className="grid grid-cols-2 gap-2 pb-6">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/agency" ? pathname === "/agency" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm",
                  active
                    ? "border-[color-mix(in_oklab,var(--accent-from)_30%,transparent)] bg-[linear-gradient(90deg,color-mix(in_oklab,var(--accent-from)_20%,transparent),color-mix(in_oklab,var(--accent-to)_10%,transparent))] text-[var(--text-1)]"
                    : "border-[var(--border-hairline)] text-[var(--text-3)]"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{label(item.href, item.label)}</span>
              </Link>
            );
          })}
        </div>
      </Drawer>
    </>
  );
}
