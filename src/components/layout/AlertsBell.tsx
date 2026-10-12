"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { getAlertsAction, markAlertReadAction, markAllAlertsReadAction, type AlertDto } from "@/lib/actions/agency-alerts";
import { timeAgo, cn } from "@/lib/utils";
import type { UiLanguage } from "@/lib/i18n";

const POLL_MS = 20_000;

/**
 * The admin's in-platform notification bell: meetings the AI offered, chats
 * that need a person, replies that failed to send. Polls while the tab is
 * visible (a server action every 20s is cheap and needs no extra infra);
 * clicking an alert opens that conversation in the Live Inbox.
 */
export function AlertsBell({ lang, className }: { lang: UiLanguage; className?: string }) {
  const ar = lang === "AR";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [alerts, setAlerts] = useState<AlertDto[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getAlertsAction();
      if (res.ok) {
        setUnread(res.unread);
        setAlerts(res.alerts);
      }
    } catch {
      // A failed poll (offline, session expired) just leaves the previous list in place.
    }
  }, []);

  useEffect(() => {
    // Deferred to a microtask so the first fetch's state updates are not synchronous inside the effect body.
    const first = setTimeout(refresh, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openAlert = async (a: AlertDto) => {
    setOpen(false);
    if (!a.read) {
      setAlerts((prev) => prev.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
      setUnread((n) => Math.max(0, n - 1));
      await markAlertReadAction(a.id);
    }
    if (a.conversationId) router.push(`/agency/inbox?conversation=${a.conversationId}`);
  };

  const markAll = async () => {
    setAlerts((prev) => prev.map((x) => ({ ...x, read: true })));
    setUnread(0);
    await markAllAlertsReadAction();
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        aria-label={ar ? "الإشعارات" : "Notifications"}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) refresh();
        }}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-3)] hover:bg-[var(--surface-2)]"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--status-hot)] px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 top-10 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-[var(--border-hairline-strong)] bg-[var(--surface-1)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2">
            <p className="text-sm font-medium text-[var(--text-1)]">{ar ? "الإشعارات" : "Notifications"}</p>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs text-[var(--text-4)] hover:text-[var(--text-1)]">
                {ar ? "تعيين الكل كمقروء" : "Mark all read"}
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {alerts.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-[var(--text-4)]">{ar ? "لا توجد إشعارات بعد" : "Nothing yet"}</p>
            ) : (
              alerts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => openAlert(a)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 border-b border-[var(--border-hairline)] px-3 py-2.5 text-start last:border-b-0 hover:bg-[var(--surface-2)]/60",
                    !a.read && "bg-[var(--surface-2)]/40"
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-1)]">
                    {!a.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-hot)]" />}
                    {a.title}
                  </span>
                  <span className="line-clamp-2 text-xs text-[var(--text-4)]" dir="auto">
                    {a.body}
                  </span>
                  <span className="text-[10px] text-[var(--text-5)]">{timeAgo(a.createdAt)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
