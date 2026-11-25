import { describe, expect, test } from "bun:test";
import type { DriveRecord, DrivingEvent, DrivingEventType } from "@openbeacon/encryption";
import { drivingScore, drivingScoreCostLabel } from "./drivingScore.ts";

const NO_COUNTS: Record<DrivingEventType, number> = {
  HARD_BRAKING: 0,
  RAPID_ACCELERATION: 0,
  SPEEDING: 0,
  PHONE_USE: 0,
};

const drive = ({
  checkedKm,
  events = [],
  extraCounts = {},
  km,
  passenger = false,
  speedLimitsChecked = true,
}: {
  checkedKm?: number;
  events?: DrivingEvent[];
  extraCounts?: Partial<Record<DrivingEventType, number>>;
  km: number;
  passenger?: boolean;
  speedLimitsChecked?: boolean;
}): DriveRecord => {
  const counts = { ...NO_COUNTS };
  for (const event of events) counts[event.type] += 1;
  for (const [type, extra] of Object.entries(extraCounts) as Array<[DrivingEventType, number]>) {
    counts[type] += extra;
  }
  return {
    driveId: "0".repeat(32),
    start: { time: 1_795_000_000_000, latitude: 51.5, longitude: -0.12 },
    end: { time: 1_795_001_800_000, latitude: 51.6, longitude: -0.2 },
    distance: km * 1_000,
    checkedDistance: (checkedKm ?? km) * 1_000,
    duration: 1_800,
    topSpeed: 30,
    averageSpeed: 15,
    utcOffsetMinutes: 0,
    counts,
    passenger,
    speedLimitsChecked,
    tellGroup: true,
    events,
  };
};

const event = (
  type: DrivingEventType,
  { duration = 3, limit = null, peak }: Partial<DrivingEvent> & { peak: number },
): DrivingEvent => ({
  type,
  timeOffset: 60,
  duration,
  latitude: 51.55,
  longitude: -0.15,
  peak,
  limit,
});

const braking = (peak: number) => event("HARD_BRAKING", { peak });
const phoneUse = (duration: number) => event("PHONE_USE", { duration, peak: 12 });
const speeding = (peak: number, limit: number, duration: number) =>
  event("SPEEDING", {
    duration,
    limit: { source: "POSTED", speed: limit },
    peak,
  });

describe("drivingScore", () => {
  test("a drive with no Driving events scores 100", () => {
    expect(drivingScore(drive({ km: 23 }))).toMatchObject({
      score: 100,
      costs: [],
    });
  });

  test("drives under 10 km are scored as 10 km, so a short trip isn't over-punished", () => {
    expect(drivingScore(drive({ events: [braking(4.1)], km: 2 }))?.score).toBe(97);
    expect(drivingScore(drive({ events: [braking(4.1)], km: 10 }))?.score).toBe(97);
  });

  test("points are scaled per 10 km of Checked distance", () => {
    expect(drivingScore(drive({ events: [braking(4.1)], km: 30 }))?.score).toBe(99);
    expect(drivingScore(drive({ checkedKm: 10, events: [braking(4.1)], km: 30 }))?.score).toBe(97);
  });

  test("harder braking costs more than gentler braking", () => {
    expect(drivingScore(drive({ events: [braking(3.1)], km: 10 }))?.score).toBe(98);
    expect(drivingScore(drive({ events: [braking(7)], km: 10 }))?.score).toBe(95);
  });

  test("phone use costs most, then speeding, then braking, then acceleration", () => {
    const cost = (single: DrivingEvent) =>
      100 - (drivingScore(drive({ events: [single], km: 10 }))?.score ?? 100);
    const phone = cost(phoneUse(4));
    const speed = cost(speeding(15.2, 13.41, 15));
    const brake = cost(braking(3.1));
    const accelerate = cost(event("RAPID_ACCELERATION", { peak: 3.1 }));
    expect([phone, speed, brake, accelerate]).toEqual([6, 4, 2, 1]);
  });

  test("speeding costs more the further over and the longer it lasts", () => {
    const score = (single: DrivingEvent) =>
      drivingScore(drive({ events: [single], km: 10 }))?.score;
    expect(score(speeding(15.2, 13.41, 15))).toBe(96);
    expect(score(speeding(20.1, 13.41, 15))).toBe(93);
    expect(score(speeding(20.1, 13.41, 120))).toBe(90);
  });

  test("the score never goes below 0", () => {
    const events = Array.from({ length: 20 }, () => phoneUse(60));
    expect(drivingScore(drive({ events, km: 5 }))?.score).toBe(0);
  });

  test("events beyond the 48 positioned ones cost the same as the least severe kept event of their type", () => {
    const events = Array.from({ length: 48 }, () => braking(4.1));
    const result = drivingScore(drive({ events, extraCounts: { HARD_BRAKING: 52 }, km: 100 }));
    expect(result?.score).toBe(70);
    expect(result?.costs).toEqual([{ count: 100, points: 30, type: "HARD_BRAKING" }]);
  });

  test("an unpositioned event of a type with no kept events costs that type's least amount", () => {
    const result = drivingScore(drive({ extraCounts: { PHONE_USE: 1 }, km: 10 }));
    expect(result?.costs).toEqual([{ count: 1, points: 6, type: "PHONE_USE" }]);
  });

  test("a drive whose speed limits weren't checked is scored on the other three inputs", () => {
    const result = drivingScore(
      drive({
        events: [speeding(20.1, 13.41, 120), phoneUse(4)],
        km: 10,
        speedLimitsChecked: false,
      }),
    );
    expect(result).toMatchObject({
      costs: [{ count: 1, points: 6, type: "PHONE_USE" }],
      score: 94,
      speedingChecked: false,
    });
  });

  test("battery saver stretches are reported as unchecked distance", () => {
    expect(drivingScore(drive({ checkedKm: 18, km: 30 }))?.uncheckedDistance).toBe(12_000);
    expect(drivingScore(drive({ km: 30 }))?.uncheckedDistance).toBe(0);
  });

  test("Passenger drives have no score", () => {
    expect(drivingScore(drive({ km: 20, passenger: true }))).toBeNull();
  });

  test("costs are listed largest first and add up to what the score lost", () => {
    const result = drivingScore(
      drive({
        events: [braking(4.1), phoneUse(4), phoneUse(4), braking(4.1)],
        km: 10,
      }),
    );
    expect(result?.costs).toEqual([
      { count: 2, points: 12, type: "PHONE_USE" },
      { count: 2, points: 6, type: "HARD_BRAKING" },
    ]);
    expect(result?.score).toBe(82);
  });
});

describe("drivingScoreCostLabel", () => {
  test("says what cost points and how many events", () => {
    expect(drivingScoreCostLabel({ count: 2, points: 8, type: "PHONE_USE" })).toBe(
      "−8 phone use (2)",
    );
    expect(
      drivingScoreCostLabel({
        count: 1,
        points: 3,
        type: "RAPID_ACCELERATION",
      }),
    ).toBe("−3 rapid acceleration (1)");
  });
});
