import { useSyncExternalStore } from "react";

export const createNativeSetting = <Value>(read: () => Value, fallback: Value) => {
  let cached: { value: Value } | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const get = () => {
    if (cached === null) {
      try {
        cached = { value: read() };
      } catch {
        cached = { value: fallback };
      }
    }
    return cached.value;
  };
  return {
    get,
    use: () => useSyncExternalStore(subscribe, get),
    update: (value: Value | null) => {
      cached = value === null ? null : { value };
      for (const listener of listeners) listener();
    },
  };
};
