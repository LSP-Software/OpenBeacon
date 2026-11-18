import type { TimelineDay, TimelineDeviceHours } from "./timelineTypes.ts";

const HOUR_MS = 60 * 60_000;

export const localDayOf = (time: number): TimelineDay => {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  return {
    end: new Date(year, month, day + 1).getTime(),
    key: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    start: new Date(year, month, day).getTime(),
  };
};

export const timelineWindowStart = ({
  devices,
  windowStart,
}: {
  devices: ReadonlyArray<{ firstHour: number }>;
  windowStart: Date;
}) =>
  new Date(Math.min(windowStart.getTime(), ...devices.map(({ firstHour }) => firstHour * HOUR_MS)));

export const buildTimelineDayPicker = ({
  devices,
  now,
  userId,
  windowStart,
}: {
  devices: ReadonlyArray<TimelineDeviceHours & { firstHour: number }>;
  now: number;
  userId?: string | undefined;
  windowStart: Date;
}) => {
  const shown = userId ? devices.filter((device) => device.senderUserId === userId) : devices;
  const firstPointAt = Math.min(...shown.map((device) => device.firstHour * HOUR_MS));
  const counts = new Map<string, number>();
  for (const device of shown) {
    for (const { count, hour } of device.hours) {
      const keys = new Set([
        localDayOf(hour * HOUR_MS).key,
        localDayOf((hour + 1) * HOUR_MS - 1).key,
      ]);
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + count);
    }
  }

  const days: Array<TimelineDay & { pointCount: number; selectable: boolean }> = [];
  const today = localDayOf(now);
  for (let day = localDayOf(windowStart.getTime()); day.start <= today.start;) {
    days.push({
      ...day,
      pointCount: counts.get(day.key) ?? 0,
      selectable: day.end > firstPointAt,
    });
    day = localDayOf(day.end);
  }
  return days;
};
