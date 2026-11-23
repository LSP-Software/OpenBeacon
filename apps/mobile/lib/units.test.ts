import { describe, expect, test } from "bun:test";
import {
  defaultUnits,
  formatDistance,
  formatSpeed,
  liveSpeedHidesAt,
  liveSpeedLabel,
  movingSpeedLabel,
  parseUnitsPreference,
  timelineSpeedLabel,
} from "./units.ts";

describe("formatDistance", () => {
  test("uses metres and kilometres with km/h", () => {
    expect(formatDistance(420.4, "kmh")).toBe("420 m");
    expect(formatDistance(12_345, "kmh")).toBe("12.3 km");
  });

  test("switches to kilometres once the metres would round to 1000", () => {
    expect(formatDistance(999.4, "kmh")).toBe("999 m");
    expect(formatDistance(999.6, "kmh")).toBe("1.0 km");
  });

  test("switches to miles once the feet would round to a tenth of a mile", () => {
    expect(formatDistance(160.78, "mph")).toBe("527 ft");
    expect(formatDistance(160.9, "mph")).toBe("0.1 mi");
  });

  test("drops the decimal from 100 upwards", () => {
    expect(formatDistance(99_940, "kmh")).toBe("99.9 km");
    expect(formatDistance(99_960, "kmh")).toBe("100 km");
    expect(formatDistance(1_234_567, "kmh")).toBe("1235 km");
    expect(formatDistance(1_234_567, "mph")).toBe("767 mi");
  });

  test("uses feet and miles with mph", () => {
    expect(formatDistance(100, "mph")).toBe("328 ft");
    expect(formatDistance(1609.344, "mph")).toBe("1.0 mi");
    expect(formatDistance(12_345, "mph")).toBe("7.7 mi");
  });
});

describe("formatSpeed", () => {
  test("converts metres per second to whole mph and km/h", () => {
    expect(formatSpeed(15.2, "mph")).toBe("34 mph");
    expect(formatSpeed(15.2, "kmh")).toBe("55 km/h");
    expect(formatSpeed(1, "mph")).toBe("2 mph");
    expect(formatSpeed(1, "kmh")).toBe("4 km/h");
  });

  test("rounds half units up", () => {
    expect(formatSpeed(12.5 / 3.6, "kmh")).toBe("13 km/h");
    expect(formatSpeed(12.4 / 3.6, "kmh")).toBe("12 km/h");
    expect(formatSpeed(31.5 / 2.2369362920544, "mph")).toBe("32 mph");
  });
});

describe("movingSpeedLabel", () => {
  test("hides speeds below walking pace or unknown", () => {
    expect(movingSpeedLabel(null, "mph")).toBeNull();
    expect(movingSpeedLabel(0, "mph")).toBeNull();
    expect(movingSpeedLabel(0.99, "kmh")).toBeNull();
    expect(movingSpeedLabel(Number.NaN, "kmh")).toBeNull();
  });

  test("shows speeds from 1 m/s", () => {
    expect(movingSpeedLabel(1, "kmh")).toBe("4 km/h");
    expect(movingSpeedLabel(30, "mph")).toBe("67 mph");
  });

  test("hides speeds too fast to be real, such as a GPS jump", () => {
    expect(movingSpeedLabel(90, "mph")).toBe("201 mph");
    expect(movingSpeedLabel(90, "kmh")).toBe("324 km/h");
    expect(movingSpeedLabel(90.1, "mph")).toBeNull();
    expect(movingSpeedLabel(120, "mph")).toBeNull();
    expect(movingSpeedLabel(Number.POSITIVE_INFINITY, "kmh")).toBeNull();
  });
});

describe("liveSpeedLabel", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  test("shows the speed of a recent moving fix", () => {
    expect(liveSpeedLabel({ now, speed: 15.2, timestamp: ago(30_000), unit: "mph" })).toBe(
      "34 mph",
    );
    expect(liveSpeedLabel({ now, speed: 15.2, timestamp: ago(3 * 60_000), unit: "mph" })).toBe(
      "34 mph",
    );
  });

  test("hides the speed once the fix is too old to still be true", () => {
    expect(
      liveSpeedLabel({ now, speed: 15.2, timestamp: ago(3 * 60_000 + 1), unit: "mph" }),
    ).toBeNull();
  });

  test("gives the first moment the speed is hidden, so a card can re-render then", () => {
    const timestamp = ago(30_000);
    const hidesAt = liveSpeedHidesAt(timestamp);
    expect(hidesAt).toBe(now - 30_000 + 3 * 60_000 + 1);
    expect(liveSpeedLabel({ now: hidesAt - 1, speed: 15.2, timestamp, unit: "mph" })).toBe(
      "34 mph",
    );
    expect(liveSpeedLabel({ now: hidesAt, speed: 15.2, timestamp, unit: "mph" })).toBeNull();
  });

  test("tolerates a minute of clock difference but hides fixes further in the future", () => {
    expect(liveSpeedLabel({ now, speed: 15.2, timestamp: ago(-60_000), unit: "mph" })).toBe(
      "34 mph",
    );
    expect(liveSpeedLabel({ now, speed: 15.2, timestamp: ago(-60_001), unit: "mph" })).toBeNull();
  });

  test("hides the speed without a usable timestamp or while still", () => {
    expect(liveSpeedLabel({ now, speed: 15.2, timestamp: null, unit: "mph" })).toBeNull();
    expect(liveSpeedLabel({ now, speed: 15.2, timestamp: "not a date", unit: "mph" })).toBeNull();
    expect(liveSpeedLabel({ now, speed: 0.4, timestamp: ago(10_000), unit: "mph" })).toBeNull();
  });
});

describe("defaultUnits", () => {
  test("uses mph in mph regions and km/h elsewhere", () => {
    expect(defaultUnits({ measurementSystem: "uk", regionCode: "GB" })).toBe("mph");
    expect(defaultUnits({ measurementSystem: "us", regionCode: "US" })).toBe("mph");
    expect(defaultUnits({ measurementSystem: "metric", regionCode: "gb" })).toBe("mph");
    expect(defaultUnits({ measurementSystem: "metric", regionCode: "FR" })).toBe("kmh");
    expect(defaultUnits({ measurementSystem: "metric", regionCode: "IE" })).toBe("kmh");
    expect(defaultUnits({ measurementSystem: "us", regionCode: "CA" })).toBe("kmh");
  });

  test("falls back to the measurement system without a region", () => {
    expect(defaultUnits({ measurementSystem: "us", regionCode: null })).toBe("mph");
    expect(defaultUnits({ measurementSystem: "uk", regionCode: null })).toBe("mph");
    expect(defaultUnits({ measurementSystem: "metric", regionCode: null })).toBe("kmh");
    expect(defaultUnits({ measurementSystem: null, regionCode: null })).toBe("kmh");
  });
});

describe("timelineSpeedLabel", () => {
  test("only gives a speed while the person is moving", () => {
    const at = (state: "moving" | "pause" | "stay") => ({ position: { speed: 15.2 }, state });
    expect(timelineSpeedLabel(at("moving"), "mph")).toBe("34 mph");
    expect(timelineSpeedLabel(at("stay"), "mph")).toBeNull();
    expect(timelineSpeedLabel(at("pause"), "mph")).toBeNull();
    expect(timelineSpeedLabel(null, "mph")).toBeNull();
  });

  test("hides an unknown, slow or impossible speed while moving", () => {
    expect(timelineSpeedLabel({ position: { speed: null }, state: "moving" }, "kmh")).toBeNull();
    expect(timelineSpeedLabel({ position: { speed: 0.5 }, state: "moving" }, "kmh")).toBeNull();
    expect(timelineSpeedLabel({ position: { speed: 95 }, state: "moving" }, "kmh")).toBeNull();
  });
});

describe("parseUnitsPreference", () => {
  test("reads a stored unit and falls back to the phone's region for anything else", () => {
    expect(parseUnitsPreference("mph")).toBe("mph");
    expect(parseUnitsPreference("kmh")).toBe("kmh");
    expect(parseUnitsPreference(undefined)).toBe("auto");
    expect(parseUnitsPreference("knots")).toBe("auto");
    expect(parseUnitsPreference("km/h")).toBe("auto");
  });
});
