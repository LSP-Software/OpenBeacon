import type { TimelineDay } from "./timelineTypes.ts";

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

export const buildTimelineDayPicker = ({
  devices,
  now,
  userId,
  windowStart,
}: {
  devices: ReadonlyArray<{
    firstReceivedAt: Date;
    hours: ReadonlyArray<{ count: number; hour: Date }>;
    senderUserId: string;
  }>;
  now: number;
  userId?: string | undefined;
  windowStart: Date;
}) => {
  const shown = userId ? devices.filter((device) => device.senderUserId === userId) : devices;
  const firstPointAt = Math.min(...shown.map((device) => device.firstReceivedAt.getTime()));
  const counts = new Map<string, number>();
  for (const device of shown) {
    for (const { count, hour } of device.hours) {
      const keys = new Set([
        localDayOf(hour.getTime()).key,
        localDayOf(hour.getTime() + 60 * 60_000 - 1).key,
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
