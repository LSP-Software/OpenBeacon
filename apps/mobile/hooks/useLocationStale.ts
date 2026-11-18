import { useEffect, useState } from "react";
import { locationStaleAt } from "../lib/locationStaleAt.ts";
import { useAppForeground } from "./useAppForeground.ts";

export const useLocationStale = (timestamp: string | null) => {
  const [, setTick] = useState(0);
  const staleAt = timestamp === null ? Number.NaN : locationStaleAt(timestamp);

  useEffect(() => {
    const delay = staleAt - Date.now();
    const timer =
      delay > 0 && Number.isFinite(delay)
        ? setTimeout(() => setTick((tick) => tick + 1), delay)
        : null;
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [staleAt]);

  useAppForeground(() => setTick((tick) => tick + 1));

  return Date.now() >= staleAt;
};
