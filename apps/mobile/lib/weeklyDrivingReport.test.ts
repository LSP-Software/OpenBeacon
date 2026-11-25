import { describe, expect, test } from "bun:test";
import type { DriveRecord, DrivingEvent, DrivingEventType } from "@openbeacon/encryption";
import { driverWeekOf, weeklyDrivingReport } from "./weeklyDrivingReport.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONDAY_23_NOV = Date.UTC(2026, 10, 23);
const MONDAY_16_NOV = Date.UTC(2026, 10, 16);

const NO_COUNTS: Record<DrivingEventType, number> = {
  HARD_BRAKING: 0,
  RAPID_ACCELERATION: 0,
  SPEEDING: 0,
  PHONE_USE: 0,
};

let nextId = 0;

const drive = ({
  at,
  events = [],
  groupId = "family",
  km = 20,
  minutes = 30,
  offset = 0,
  passenger = false,
  speedLimitsChecked = true,
  topSpeed = 30,
  driveId = (nextId++).toString(16).padStart(32, "0"),
}: {
  at: number;
  driveId?: string;
  events?: DrivingEvent[];
  groupId?: string;
  km?: number;
  minutes?: number;
  offset?: number;
  passenger?: boolean;
  speedLimitsChecked?: boolean;
  topSpeed?: number;
}) => {
  const counts = { ...NO_COUNTS };
  for (const event of events) counts[event.type] += 1;
  const record: DriveRecord = {
    driveId,
    start: { time: at, latitude: 51.5, longitude: -0.12 },
    end: { time: at + minutes * MINUTE, latitude: 51.6, longitude: -0.2 },
    distance: km * 1_000,
    checkedDistance: km * 1_000,
    duration: minutes * 60,
    topSpeed,
    averageSpeed: 15,
    utcOffsetMinutes: offset,
    counts,
    passenger,
    speedLimitsChecked,
    tellGroup: true,
    events,
  };
  return { driveId, groupId, record };
};

const phoneUse = (duration: number): DrivingEvent => ({
  type: "PHONE_USE",
  timeOffset: 60,
  duration,
  latitude: 51.55,
  longitude: -0.15,
  peak: 12,
  limit: null,
});

const braking = (peak: number): DrivingEvent => ({
  ...phoneUse(1),
  type: "HARD_BRAKING",
  peak,
});

const mondayOf = (utcMidnight: number) => utcMidnight / DAY;

describe("the driver's week", () => {
  test("runs Monday 00:00 to Sunday 23:59 in the driver's own time zone", () => {
    expect(driverWeekOf(MONDAY_23_NOV - 30 * MINUTE, 0)).toEqual({
      monday: mondayOf(MONDAY_16_NOV),
      weekday: 6,
    });
    expect(driverWeekOf(MONDAY_23_NOV - 30 * MINUTE, 60)).toEqual({
      monday: mondayOf(MONDAY_23_NOV),
      weekday: 0,
    });
    expect(driverWeekOf(MONDAY_23_NOV + 30 * MINUTE, -300)).toEqual({
      monday: mondayOf(MONDAY_16_NOV),
      weekday: 6,
    });
  });

  test("puts a drive in the week its driver's clock showed when it started, across a clock change", () => {
    const sundayAfterMidnightBst = Date.UTC(2026, 9, 24, 23, 30);
    const mondayAfterMidnightGmt = Date.UTC(2026, 9, 26, 0, 30);
    const monday19Oct = mondayOf(Date.UTC(2026, 9, 19));
    const report = weeklyDrivingReport({
      drives: [
        drive({ at: sundayAfterMidnightBst, offset: 60 }),
        drive({ at: mondayAfterMidnightGmt, offset: 0 }),
        drive({ at: Date.UTC(2026, 9, 18, 23, 30), offset: 60 }),
      ],
      monday: monday19Oct,
      now: Date.UTC(2026, 10, 1),
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.driving.drives).toBe(2);
    expect(report.days.map((day) => day.drives)).toEqual([1, 0, 0, 0, 0, 0, 1]);
  });

  test("keeps a drive that crosses midnight into Monday in the week it started", () => {
    const lateSunday = MONDAY_23_NOV - 20 * MINUTE;
    const lastWeek = weeklyDrivingReport({
      drives: [drive({ at: lateSunday, minutes: 50, km: 60 })],
      monday: mondayOf(MONDAY_16_NOV),
      now: MONDAY_23_NOV + 3 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    const thisWeek = weeklyDrivingReport({
      drives: [drive({ at: lateSunday, minutes: 50, km: 60 })],
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 3 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(lastWeek.driving.distance).toBe(60_000);
    expect(lastWeek.days[6]?.drives).toBe(1);
    expect(thisWeek.driving.drives).toBe(0);
  });
});

describe("what the report counts", () => {
  test("counts a drive shared with several Groups once", () => {
    const shared = drive({ at: MONDAY_23_NOV + 9 * HOUR, km: 15 });
    const report = weeklyDrivingReport({
      drives: [shared, { ...shared, groupId: "work" }, { ...shared, groupId: "club" }],
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 2 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.driving.drives).toBe(1);
    expect(report.driving.distance).toBe(15_000);
    expect(report.drives).toHaveLength(1);
  });

  test("uses a readable copy when another Group's copy can't be opened", () => {
    const shared = drive({ at: MONDAY_23_NOV + 9 * HOUR, km: 15 });
    const report = weeklyDrivingReport({
      drives: [{ ...shared, groupId: "work", record: null }, shared],
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 2 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.driving.drives).toBe(1);
  });

  test("weights the weekly score by distance", () => {
    const report = weeklyDrivingReport({
      drives: [
        drive({ at: MONDAY_23_NOV + 9 * HOUR, km: 30 }),
        drive({
          at: MONDAY_23_NOV + 18 * HOUR,
          km: 10,
          events: [phoneUse(60)],
        }),
      ],
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 2 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.driving.score).toBe(98);
    expect(report.days[0]?.score).toBe(98);
  });

  test("breaks the weekly score down by event type so the lines add up to it", () => {
    const report = weeklyDrivingReport({
      drives: [
        drive({
          at: MONDAY_23_NOV + 9 * HOUR,
          km: 10,
          events: [phoneUse(60), braking(5.1)],
        }),
        drive({ at: MONDAY_23_NOV + DAY, km: 10, events: [braking(4.1)] }),
        drive({ at: MONDAY_23_NOV + 2 * DAY, km: 10 }),
      ],
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 3 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.driving.score).toBe(95);
    expect(report.driving.costs).toEqual([
      { type: "PHONE_USE", count: 1, points: 3 },
      { type: "HARD_BRAKING", count: 2, points: 2 },
      { type: "SPEEDING", count: 0, points: 0 },
      { type: "RAPID_ACCELERATION", count: 0, points: 0 },
    ]);
    expect(100 - report.driving.costs.reduce((sum, cost) => sum + cost.points, 0)).toBe(95);
  });

  test("still adds up when a drive's own score bottoms out at 0", () => {
    const awful = Array.from({ length: 20 }, () => phoneUse(120));
    const report = weeklyDrivingReport({
      drives: [
        drive({ at: MONDAY_23_NOV + 9 * HOUR, km: 5, events: awful }),
        drive({ at: MONDAY_23_NOV + DAY, km: 15 }),
      ],
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 3 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.driving.score).toBe(75);
    expect(report.driving.costs[0]).toEqual({
      type: "PHONE_USE",
      count: 20,
      points: 25,
    });
  });

  test("counts Passenger drives nowhere but their own line", () => {
    const report = weeklyDrivingReport({
      drives: [
        drive({ at: MONDAY_23_NOV + 9 * HOUR, km: 10 }),
        drive({
          at: MONDAY_23_NOV + DAY,
          km: 90,
          minutes: 300,
          passenger: true,
          topSpeed: 60,
        }),
        drive({ at: MONDAY_23_NOV + 2 * DAY, km: 8, passenger: true }),
      ],
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 3 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.driving).toMatchObject({
      drives: 1,
      distance: 10_000,
      duration: 1_800,
      topSpeed: 30,
      score: 100,
      speedingChecked: { checked: 1, of: 1 },
    });
    expect(report.days.map((day) => day.drives)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(report.passenger).toEqual({ count: 2, distance: 98_000 });
    expect(report.drives).toHaveLength(3);
  });

  test("has no score when every drive was a Passenger drive", () => {
    const report = weeklyDrivingReport({
      drives: [drive({ at: MONDAY_23_NOV + 9 * HOUR, passenger: true })],
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 3 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.driving.score).toBeNull();
    expect(report.driving.drives).toBe(0);
    expect(report.passenger.count).toBe(1);
  });

  test("says on how many drives speeding was checked", () => {
    const report = weeklyDrivingReport({
      drives: [
        drive({ at: MONDAY_23_NOV + 9 * HOUR }),
        drive({ at: MONDAY_23_NOV + 10 * HOUR, speedLimitsChecked: false }),
        drive({ at: MONDAY_23_NOV + 11 * HOUR }),
      ],
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 3 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.driving.speedingChecked).toEqual({ checked: 2, of: 3 });
  });
});

describe("comparing with last week", () => {
  const tuesdayNoon = MONDAY_23_NOV + DAY + 12 * HOUR;
  const lastWeek = [
    drive({ at: MONDAY_16_NOV + 8 * HOUR, km: 10 }),
    drive({ at: MONDAY_16_NOV + DAY + 20 * HOUR, km: 10 }),
    drive({ at: MONDAY_16_NOV + 2 * DAY + 8 * HOUR, km: 50 }),
    drive({ at: MONDAY_16_NOV + 6 * DAY + 8 * HOUR, km: 50 }),
  ];

  test("compares a week under way with the same days of last week", () => {
    const report = weeklyDrivingReport({
      drives: [...lastWeek, drive({ at: MONDAY_23_NOV + 8 * HOUR, km: 12 })],
      monday: mondayOf(MONDAY_23_NOV),
      now: tuesdayNoon,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.current).toBe(true);
    expect(report.lastDay).toBe(1);
    expect(report.previous).toMatchObject({ drives: 2, distance: 20_000 });
    expect(report.weekBefore).toMatchObject({ drives: 4, distance: 120_000 });
  });

  test("compares a finished week with the whole of the week before", () => {
    const report = weeklyDrivingReport({
      drives: lastWeek,
      monday: mondayOf(MONDAY_23_NOV) + 7,
      now: MONDAY_23_NOV + 9 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(report.current).toBe(true);
    const finished = weeklyDrivingReport({
      drives: lastWeek,
      monday: mondayOf(MONDAY_23_NOV),
      now: MONDAY_23_NOV + 9 * DAY,
      offsetMinutes: 0,
      visibleFrom: null,
    });
    expect(finished.current).toBe(false);
    expect(finished.lastDay).toBe(6);
    expect(finished.previous).toMatchObject({ drives: 4 });
  });

  test("leaves the comparison out when the viewer can't see all of last week", () => {
    const report = weeklyDrivingReport({
      drives: lastWeek,
      monday: mondayOf(MONDAY_23_NOV),
      now: tuesdayNoon,
      offsetMinutes: 0,
      visibleFrom: MONDAY_16_NOV + 6 * HOUR,
    });
    expect(report.previous).toBeNull();
    expect(report.weekBefore).toBeNull();
    expect(report.firstVisibleDay).toBe(0);
    expect(report.canGoBack).toBe(true);
  });
});

describe("a week the viewer sees only part of", () => {
  test("says which days it covers and dims the rest", () => {
    const saturday = MONDAY_16_NOV + 5 * DAY;
    const report = weeklyDrivingReport({
      drives: [drive({ at: saturday + 10 * HOUR }), drive({ at: saturday + DAY + 10 * HOUR })],
      monday: mondayOf(MONDAY_16_NOV),
      now: MONDAY_23_NOV + DAY,
      offsetMinutes: 0,
      visibleFrom: saturday + 7 * HOUR,
    });
    expect(report.firstVisibleDay).toBe(5);
    expect(report.days.map((day) => day.visible)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(report.previous).toBeNull();
    expect(report.canGoBack).toBe(false);
  });

  test("uses the viewer's reference offset for the visible days", () => {
    const report = weeklyDrivingReport({
      drives: [],
      monday: mondayOf(MONDAY_16_NOV),
      now: MONDAY_23_NOV + DAY,
      offsetMinutes: 60,
      visibleFrom: MONDAY_16_NOV + 5 * DAY - 30 * MINUTE,
    });
    expect(report.firstVisibleDay).toBe(5);
  });
});
