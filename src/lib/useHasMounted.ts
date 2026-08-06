"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * True only after client-side hydration has completed. Use to defer
 * rendering values that legitimately differ between server and client
 * (e.g. next-themes' resolved theme) so React never mismatches on the
 * initial paint. Built on useSyncExternalStore rather than a mount-effect
 * so it doesn't trip react-hooks/set-state-in-effect.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
