import { useSyncExternalStore } from "react";

/**
 * Tracks a CSS media query. SSR-safe: the server snapshot is `false`, so
 * anything gated on a match renders in its narrow/default form during SSR
 * and upgrades after hydration.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
