import { useEffect, useState } from "react";
import { getTimeSinceRefreshIntervalMs, timeSince } from "../lib/timeSince.ts";

export const useTimeSince = (timestamp: string) => {
  const [, setTick] = useState(0);
  const label = timeSince(timestamp);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      timer = setTimeout(() => {
        if (cancelled) {
          return;
        }
        setTick((value) => value + 1);
        if (!cancelled) {
          schedule();
        }
      }, getTimeSinceRefreshIntervalMs(timestamp));
    };

    schedule();

    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [timestamp]);

  return label;
};
