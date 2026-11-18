import { timelineFetchWindow } from "./timelineLoad.ts";
import type { TimelineDay } from "./timelineTypes.ts";

export const MAX_TIMELINE_POINTS = 12_000;

const HOUR_MS = 60 * 60_000;

export const pickTimelinePeople = ({
  chosen,
  day,
  devices,
  memberIds,
  now,
  selectedUserId,
}: {
  chosen: readonly string[] | null;
  day: TimelineDay;
  devices: ReadonlyArray<{
    hours: ReadonlyArray<{ count: number; hour: Date }>;
    senderUserId: string;
  }>;
  memberIds: readonly string[];
  now: number;
  selectedUserId: string | null;
}) => {
  const { from, to } = timelineFetchWindow(day, now);
  const points = new Map(memberIds.map((userId) => [userId, 0]));
  for (const device of devices) {
    const inWindow = device.hours
      .filter(({ hour }) => hour.getTime() < to && hour.getTime() + HOUR_MS > from)
      .reduce((total, { count }) => total + count, 0);
    points.set(device.senderUserId, (points.get(device.senderUserId) ?? 0) + inWindow);
  }
  const people = [...points].map(([userId, count]) => ({ points: count, userId }));
  const everyoneFits =
    people.reduce((total, person) => total + person.points, 0) <= MAX_TIMELINE_POINTS;

  const candidates = [
    ...new Set([
      ...(selectedUserId ? [selectedUserId] : []),
      ...(chosen && !everyoneFits ? chosen : []),
      ...people
        .filter((person) => !chosen || everyoneFits || person.points === 0)
        .map((person) => person.userId),
    ]),
  ];
  const shown: string[] = [];
  let total = 0;
  for (const userId of candidates) {
    const count = points.get(userId) ?? 0;
    if (shown.length > 0 && count > 0 && total + count > MAX_TIMELINE_POINTS) continue;
    shown.push(userId);
    total += count;
  }
  return { everyoneFits, people, shown };
};
