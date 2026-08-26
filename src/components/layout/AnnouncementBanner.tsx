"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Megaphone } from "lucide-react";

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  sentAt: string | null;
}

const DISMISSED_KEY = "nexaris-dismissed-announcements";

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function persistDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]));
  } catch {
    // localStorage unavailable (private mode, blocked) -- dismissal just
    // won't stick across reloads, not worth surfacing an error for.
  }
}

/**
 * Renders every un-dismissed announcement passed in, newest first.
 * Dismissal is per-VIEWER (localStorage), not a server round-trip -- this
 * is "don't show me this again", not an audit-relevant action, so there's
 * no ReadReceipt table or similar to keep in sync.
 */
export function AnnouncementBanner({ items }: { items: AnnouncementItem[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
    setHydrated(true);
  }, []);

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(id);
      persistDismissed(next);
      return next;
    });
  };

  // Render nothing until localStorage has been read once -- avoids a
  // server/client mismatch flash (SSR always has an empty dismissed set).
  if (!hydrated) return null;

  const visible = items.filter((i) => !dismissed.has(i.id));
  if (visible.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      <AnimatePresence mode="popLayout">
        {visible.map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="glass overflow-hidden rounded-2xl border border-[var(--accent-from)]/20"
          >
            {item.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- local-disk upload, not an optimizable remote asset
              <img src={item.imageUrl} alt="" className="max-h-64 w-full object-cover" />
            )}
            <div className="flex items-start gap-3 p-4">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-from)]/15">
                <Megaphone className="h-4 w-4 text-[var(--accent-from)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text-1)]">{item.title}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-3)]">{item.body}</p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss announcement"
                className="shrink-0 rounded-lg p-1.5 text-[var(--text-5)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-2)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
