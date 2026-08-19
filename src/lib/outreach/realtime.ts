"use client";

import { useEffect, useRef } from "react";
import { getSupabaseRealtimeClient } from "./supabase-realtime";

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

  useEffect(() => {
    if (!enabled) return;

    const debouncedReload = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(reload, debounceMs);
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
