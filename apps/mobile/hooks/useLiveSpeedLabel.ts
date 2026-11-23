import { useEffect, useState } from "react";
import { liveSpeedHidesAt, liveSpeedLabel } from "../lib/units.ts";
import { useUnits } from "./useUnits.ts";

export const useLiveSpeedLabel = ({
  speed,
  timestamp,
}: {
  speed: number | null;
  timestamp: string | null;
}) => {
  const { unit } = useUnits();
  const [, setTick] = useState(0);
  const label = liveSpeedLabel({ now: Date.now(), speed, timestamp, unit });
  const hidesAt = label === null || timestamp === null ? null : liveSpeedHidesAt(timestamp);

  useEffect(() => {
    if (hidesAt === null) return;
    const timer = setTimeout(
      () => setTick((value) => value + 1),
      Math.max(0, hidesAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [hidesAt]);

  return label;
};
