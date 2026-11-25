import { describe, expect, test } from "bun:test";
import type { DriveRecord, DrivingEvent } from "@openbeacon/encryption";
import { driveTitle, drivingEventLines, drivingScoreReason } from "./driveFormat.ts";

const event = (type: DrivingEvent["type"], peak: number, duration: number): DrivingEvent => ({
  type,
  timeOffset: 60,
  duration,
  latitude: 51.5,
  longitude: -0.1,
  peak,
  limit: type === "SPEEDING" ? { source: "POSTED", speed: 13.4112 } : null,
});

const record = (events: DrivingEvent[], passenger = false): DriveRecord => ({
  driveId: "a".repeat(32),
  start: { time: 0, latitude: 51.5, longitude: -0.1 },
  end: { time: 2_520_000, latitude: 51.6, longitude: -0.2 },
  distance: 37_015,
  checkedDistance: 37_015,
  duration: 2_520,
  topSpeed: 31.7,
  averageSpeed: 14.7,
  utcOffsetMinutes: 0,
  counts: {
    HARD_BRAKING: events.filter((item) => item.type === "HARD_BRAKING").length,
    RAPID_ACCELERATION: events.filter((item) => item.type === "RAPID_ACCELERATION").length,
    SPEEDING: events.filter((item) => item.type === "SPEEDING").length,
    PHONE_USE: events.filter((item) => item.type === "PHONE_USE").length,
  },
  passenger,
  speedLimitsChecked: true,
  tellGroup: true,
  events,
});

describe("drive wording", () => {
  test("names the start and end Places when they're known", () => {
    expect(driveTitle("Work", "Home")).toBe("Work → Home");
    expect(driveTitle(null, "Home")).toBe("To Home");
    expect(driveTitle(null, null)).toBe("Drive");
  });

  test("calls every Driving event possible and says which type cost most", () => {
    expect(
      drivingScoreReason(
        record([
          event("SPEEDING", 18.3, 22),
          event("HARD_BRAKING", 4, 2),
          event("PHONE_USE", 12, 60),
        ]),
        "mi",
      ),
    ).toBe("3 possible Driving events in 23.0 mi. Phone use counted most.");
    expect(drivingScoreReason(record([]), "km")).toBe("No possible Driving events in 37.0 km.");
    expect(drivingScoreReason(record([], true), "km")).toBeNull();
  });

  test("speeding says the speed, how long and where the limit came from", () => {
    expect(drivingEventLines(event("SPEEDING", 18.3, 22), "mph")).toEqual({
      title: "Speeding · 41 mph for 22 s",
      detail: "posted limit 30 mph",
    });
  });
});
