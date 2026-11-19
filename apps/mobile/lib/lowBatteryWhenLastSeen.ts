import { locationStaleAt } from "./locationStaleAt.ts";

export const lowBatteryWhenLastSeen = ({
  battery,
  now,
  timestamp,
}: {
  battery: { charging: boolean; level: number | null } | null;
  now: number;
  timestamp: string | null;
}) =>
  battery !== null &&
  !battery.charging &&
  battery.level !== null &&
  battery.level <= 10 &&
  timestamp !== null &&
  now >= locationStaleAt(timestamp)
    ? battery.level
    : null;
