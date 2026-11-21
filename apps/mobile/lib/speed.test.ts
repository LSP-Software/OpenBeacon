import { describe, expect, test } from "bun:test";
import {
  defaultSpeedUnit,
  formatSpeed,
  liveSpeedHidesAt,
  liveSpeedLabel,
  movingSpeedLabel,
} from "./speed.ts";

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

describe("defaultSpeedUnit", () => {
  test("uses mph in mph regions and km/h elsewhere", () => {
    expect(defaultSpeedUnit({ measurementSystem: "uk", regionCode: "GB" })).toBe("mph");
    expect(defaultSpeedUnit({ measurementSystem: "us", regionCode: "US" })).toBe("mph");
    expect(defaultSpeedUnit({ measurementSystem: "metric", regionCode: "gb" })).toBe("mph");
    expect(defaultSpeedUnit({ measurementSystem: "metric", regionCode: "FR" })).toBe("kmh");
    expect(defaultSpeedUnit({ measurementSystem: "metric", regionCode: "IE" })).toBe("kmh");
    expect(defaultSpeedUnit({ measurementSystem: "us", regionCode: "CA" })).toBe("kmh");
  });

  test("falls back to the measurement system without a region", () => {
    expect(defaultSpeedUnit({ measurementSystem: "us", regionCode: null })).toBe("mph");
    expect(defaultSpeedUnit({ measurementSystem: "uk", regionCode: null })).toBe("mph");
    expect(defaultSpeedUnit({ measurementSystem: "metric", regionCode: null })).toBe("kmh");
    expect(defaultSpeedUnit({ measurementSystem: null, regionCode: null })).toBe("kmh");
  });
});
