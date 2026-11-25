import type { DriveRecord, DrivingEventType } from "@openbeacon/encryption";
import { drivingScore } from "./drivingScore.ts";

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const REPORT_ORDER: readonly DrivingEventType[] = [
  "SPEEDING",
  "HARD_BRAKING",
  "RAPID_ACCELERATION",
  "PHONE_USE",
];

type ReadableDrive<Drive> = Drive & { record: DriveRecord };

const isReadable = <Drive extends { record: DriveRecord | null }>(
  drive: Drive,
): drive is ReadableDrive<Drive> => drive.record !== null;

export const driverWeekOf = (time: number, offsetMinutes: number) => {
  const day = Math.floor((time + offsetMinutes * MINUTE_MS) / DAY_MS);
  const weekday = (((day + 3) % 7) + 7) % 7;
  return { monday: day - weekday, weekday };
};

const weekDriving = (drives: ReadonlyArray<{ record: DriveRecord }>) => {
  const scored = drives.flatMap(({ record }) => {
    const score = drivingScore(record);
    return score ? [{ record, score }] : [];
  });
  const totalWeight = scored.reduce((sum, { record }) => sum + record.distance, 0);
  const weightOf = (record: DriveRecord) =>
    totalWeight > 0 ? record.distance / totalWeight : 1 / scored.length;
  const exactScore = scored.reduce(
    (sum, { record, score }) => sum + score.score * weightOf(record),
    0,
  );
  const score = scored.length > 0 ? Math.round(exactScore) : null;
  const exactCosts = REPORT_ORDER.map((type) => {
    let count = 0;
    let exact = 0;
    for (const { record, score: driveScore } of scored) {
      if (type === "SPEEDING" && !record.speedLimitsChecked) continue;
      count += Math.max(
        record.counts[type],
        record.events.filter((event) => event.type === type).length,
      );
      const lost = 100 - driveScore.score;
      const listed = driveScore.costs.reduce((sum, cost) => sum + cost.points, 0);
      const points = driveScore.costs.find((cost) => cost.type === type)?.points ?? 0;
      if (listed > 0) exact += points * (lost / listed) * weightOf(record);
    }
    return { count, exact, type };
  });
  const target = score === null ? 0 : 100 - score;
  let spare = target - exactCosts.reduce((sum, cost) => sum + Math.floor(cost.exact), 0);
  const roundedUp = new Set(
    [...exactCosts]
      .sort(
        (first, second) =>
          second.exact - Math.floor(second.exact) - (first.exact - Math.floor(first.exact)),
      )
      .filter(() => spare-- > 0)
      .map((cost) => cost.type),
  );
  const costs = exactCosts
    .map(({ count, exact, type }) => ({
      type,
      count,
      points: Math.floor(exact) + (roundedUp.has(type) ? 1 : 0),
    }))
    .sort((first, second) => second.points - first.points);
  return {
    checkedDistance: scored.reduce((sum, { record }) => sum + record.checkedDistance, 0),
    costs,
    distance: scored.reduce((sum, { record }) => sum + record.distance, 0),
    drives: scored.length,
    duration: scored.reduce((sum, { record }) => sum + record.duration, 0),
    score,
    speedingChecked: {
      checked: scored.filter(({ record }) => record.speedLimitsChecked).length,
      of: scored.length,
    },
    topSpeed: Math.max(0, ...scored.map(({ record }) => record.topSpeed)),
  };
};

export const weeklyDrivingReport = <Drive extends { driveId: string; record: DriveRecord | null }>({
  drives,
  monday,
  now,
  offsetMinutes,
  visibleFrom,
}: {
  drives: readonly Drive[];
  monday: number;
  now: number;
  offsetMinutes: number;
  visibleFrom: number | null;
}) => {
  const unique = new Map<string, ReadableDrive<Drive>>();
  for (const drive of drives) {
    if (isReadable(drive) && !unique.has(drive.driveId)) unique.set(drive.driveId, drive);
  }
  const placed = [...unique.values()].map((drive) => ({
    drive,
    ...driverWeekOf(drive.record.start.time, drive.record.utcOffsetMinutes),
  }));
  const dayStart = (day: number) => day * DAY_MS - offsetMinutes * MINUTE_MS;
  const visible = (fromDay: number) => visibleFrom === null || visibleFrom <= dayStart(fromDay);
  const today = driverWeekOf(now, offsetMinutes);
  const current = today.monday === monday;
  const lastDay = current ? today.weekday : 6;
  const inWeek = (weekMonday: number, upTo: number) =>
    placed
      .filter((item) => item.monday === weekMonday && item.weekday <= upTo)
      .map((item) => item.drive);
  const thisWeek = inWeek(monday, 6);
  const driving = thisWeek.filter((drive) => !drive.record.passenger);
  const passenger = thisWeek.filter((drive) => drive.record.passenger);
  let firstVisibleDay = 0;
  while (
    firstVisibleDay < 7 &&
    visibleFrom !== null &&
    visibleFrom >= dayStart(monday + firstVisibleDay + 1)
  ) {
    firstVisibleDay += 1;
  }
  const previousVisible = visible(monday - 7);
  const previousDriving = (upTo: number) =>
    weekDriving(inWeek(monday - 7, upTo).filter((drive) => !drive.record.passenger));
  return {
    canGoBack: visibleFrom === null || visibleFrom < dayStart(monday),
    current,
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
      const day = weekDriving(
        placed
          .filter((item) => item.monday === monday && item.weekday === weekday)
          .map((item) => item.drive)
          .filter((drive) => !drive.record.passenger),
      );
      return {
        drives: day.drives,
        score: day.score,
        visible: weekday >= firstVisibleDay,
        weekday,
      };
    }),
    drives: [...thisWeek].sort(
      (first, second) => second.record.start.time - first.record.start.time,
    ),
    driving: weekDriving(driving),
    firstVisibleDay,
    lastDay,
    monday,
    passenger: {
      count: passenger.length,
      distance: passenger.reduce((sum, drive) => sum + drive.record.distance, 0),
    },
    previous: previousVisible ? previousDriving(lastDay) : null,
    weekBefore: previousVisible ? previousDriving(6) : null,
  };
};
