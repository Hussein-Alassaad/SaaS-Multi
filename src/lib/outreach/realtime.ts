"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseRealtimeClient } from "./supabase-realtime";
import { PAGE_TRANSITION_MS } from "@/components/layout/PageTransition";

/**
 * Subscribes to Postgres change events on one table, scoped server-side to
 * a single tenant via Supabase Realtime's native filter syntax (never
 * client-side post-filtering, which would mean other tenants' row data
 * crosses the wire before being discarded). Returns an unsubscribe
 * function; caller is responsible for calling it on cleanup.
 *
 * Subscribing is deferred by one requestAnimationFrame -- reproduces a fix
 * from the original single-tenant version: Supabase Realtime shares one
 * WebSocket across channels, so an outgoing page's removeChannel() and an
 * incoming page's subscribe() landing in the same tick could otherwise
 * transiently close a connection that's still needed.
 */
export function subscribeOutreachChannel(opts: {
  table: string;
  tenantId: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  onChange: () => void;
}): () => void {
  const supabase = getSupabaseRealtimeClient();
  const channel = supabase
    .channel(`outreach:${opts.table}:${opts.tenantId}`)
    .on(
      "postgres_changes" as never,
      {
        event: opts.event ?? "*",
        schema: "public",
        table: opts.table,
        filter: `tenant_id=eq.${opts.tenantId}`,
      },
      () => opts.onChange()
    );

  const raf = requestAnimationFrame(() => {
    channel.subscribe();
  });

  return () => {
    cancelAnimationFrame(raf);
    supabase.removeChannel(channel);
  };
}

/**
 * React hook wrapping subscribeOutreachChannel + a debounce so a burst of
 * DB changes (e.g. one agent cycle touching many rows) collapses into a
 * single reload rather than one per row. `reload` should be stable
 * (wrapped in useCallback by the caller) or this re-subscribes every
 * render.
 */
export function useOutreachRealtime(opts: {
  table: string;
  tenantId: string;
  event?: "*" | "INSERT" | "UPDATE" | "DELETE";
  reload: () => void;
  debounceMs?: number;
  enabled?: boolean;
}) {
  const { table, tenantId, event, reload, debounceMs = 400, enabled = true } = opts;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();

  // A router.refresh() that lands while the page-transition animation is
  // still running re-renders the whole tree mid-animation, which drops
  // frames right when the user is watching the new page fade in. The
  // debounce alone doesn't prevent this: it's measured from the DB event,
  // which can arrive at any point relative to a navigation. Instead, track
  // when the route last changed and hold a pending reload until the
  // transition has finished. Live updates still land -- just a beat later
  // when they'd otherwise collide with a navigation.
  const routeChangedAt = useRef(0);
  useEffect(() => {
    routeChangedAt.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    if (!enabled) return;

    const debouncedReload = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const sinceNav = Date.now() - routeChangedAt.current;
      // PAGE_TRANSITION_MS is the PageTransition duration; the small buffer
      // covers the frame the exit/enter actually settles on.
      const wait =
        sinceNav < PAGE_TRANSITION_MS
          ? Math.max(debounceMs, PAGE_TRANSITION_MS - sinceNav + 50)
          : debounceMs;
      timeoutRef.current = setTimeout(reload, wait);
    };

    const unsubscribe = subscribeOutreachChannel({
      table,
      tenantId,
      event,
      onChange: debouncedReload,
    });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, tenantId, event, enabled, debounceMs]);
}
