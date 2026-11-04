import { useSyncExternalStore } from "react";

/** A tiny shared store: one value, change listeners, a React hook. Used for captures and settings. */
export function observable<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useObservable<T>(o: ReturnType<typeof observable<T>>): T {
  return useSyncExternalStore(o.subscribe, o.get, o.get);
}
