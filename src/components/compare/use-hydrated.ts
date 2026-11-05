"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false during SSR and the hydration pass, true afterwards. Lets controls render a native,
 * no-JS fallback in server HTML and switch to the enhanced widget once JavaScript is running.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
