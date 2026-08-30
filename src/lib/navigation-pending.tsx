"use client";

import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * useLinkStatus's `pending` is only readable from a descendant of the
 * specific <Link> that's navigating -- there's no ambient "is ANY
 * navigation pending" signal. This is a tiny store + context so a
 * <NavPendingSignal /> placed inside each nav <Link> (see OutreachSidebar)
 * can report its own pending state up to one shared place, which
 * PageTransition subscribes to show an always-instant loading overlay --
 * one that never depends on server data or Suspense timing (see
 * PageTransition.tsx's comment for why those can still have a real gap
 * under slow/throttled conditions even with loading.tsx in place).
 */
function createPendingStore() {
  let pendingCount = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return pendingCount > 0;
    },
    setPending(isPending: boolean, wasPending: boolean) {
      if (isPending === wasPending) return;
      pendingCount += isPending ? 1 : -1;
      listeners.forEach((l) => l());
    },
  };
}

const NavPendingContext = createContext<ReturnType<typeof createPendingStore> | null>(null);

export function NavPendingProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<ReturnType<typeof createPendingStore> | null>(null);
  if (!storeRef.current) storeRef.current = createPendingStore();
  return <NavPendingContext.Provider value={storeRef.current}>{children}</NavPendingContext.Provider>;
}

/** Read from PageTransition: true the instant any nav link's click registers as pending. */
export function useIsNavPending(): boolean {
  const store = useContext(NavPendingContext);
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => {}),
    () => store?.getSnapshot() ?? false,
    () => false
  );
}

/** Reports one <Link>'s pending state into the shared store. */
export function useReportNavPending(pending: boolean) {
  const store = useContext(NavPendingContext);
  const wasPendingRef = useRef(false);
  useEffect(() => {
    store?.setPending(pending, wasPendingRef.current);
    wasPendingRef.current = pending;
  }, [store, pending]);
}
