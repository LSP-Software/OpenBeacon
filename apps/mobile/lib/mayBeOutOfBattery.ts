export const mayBeOutOfBattery = ({
  battery,
  now = Date.now(),
  timestamp,
}: {
  battery: { charging: boolean; level: number | null } | null;
  now?: number;
  timestamp: string | null;
}) =>
  battery !== null &&
  !battery.charging &&
  battery.level !== null &&
  battery.level <= 10 &&
  timestamp !== null &&
  now - Date.parse(timestamp) > 30 * 60_000;
