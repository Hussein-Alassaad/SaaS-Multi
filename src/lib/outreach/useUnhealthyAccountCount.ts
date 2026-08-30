"use client";

import { useEffect, useState } from "react";
import { getUnhealthyAccountCountAction } from "@/lib/actions/outreach-accounts";

/**
 * Fetched client-side, after mount -- see getUnhealthyAccountCountAction's
 * comment for why this was pulled out of OutreachLayout's blocking
 * server-render path. Starts at 0 (matches the old default prop) and fills
 * in a beat after first paint; a 60s poll keeps the badge roughly fresh
 * without adding any per-navigation cost.
 */
export function useUnhealthyAccountCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      getUnhealthyAccountCountAction().then((n) => {
        if (!cancelled) setCount(n);
      });
    };

    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return count;
}
