"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bell, Moon, Sun, LogOut, Languages } from "lucide-react";
import { useTheme } from "next-themes";
import { logoutAction } from "@/lib/actions/auth";
import { setUiLanguageAction } from "@/lib/actions/agency-ui-language";
import { useHasMounted } from "@/lib/useHasMounted";
import { getDictionary, type UiLanguage } from "@/lib/i18n";

interface CurrentUser {
  name: string;
  role: string;
}

export function AgencyMobileTopBar({ currentUser, lang }: { currentUser: CurrentUser | null; lang: UiLanguage }) {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const mounted = useHasMounted();
  const [, startTransition] = useTransition();
  const initial = currentUser?.name?.trim()?.[0]?.toUpperCase() ?? "A";
  const t = getDictionary(lang);

  const handleToggleLanguage = () => {
    startTransition(async () => {
      await setUiLanguageAction(lang === "AR" ? "EN" : "AR");
      router.refresh();
    });
  };

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--border-hairline)] bg-[var(--surface-1)]/80 px-4 backdrop-blur-xl md:hidden">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-gradient text-xs font-bold text-white">
          {initial}
        </div>
        <span className="text-sm font-semibold text-gradient">Agency OS</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          aria-label={t.common.notifications}
          className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute end-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--status-hot)]" />
        </button>
        <button
          aria-label={t.common.toggleLanguage}
          onClick={handleToggleLanguage}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"
        >
          <Languages className="h-4 w-4" />
        </button>
        <button
          aria-label={t.common.toggleTheme}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"
        >
          {mounted && theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <form action={logoutAction}>
          <button
            type="submit"
            aria-label={t.common.signOut}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
