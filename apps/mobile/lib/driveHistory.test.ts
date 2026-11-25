import { describe, expect, test } from "bun:test";
import type { DriveRecord } from "@openbeacon/encryption";
import { driveHistoryItems } from "./driveHistory.ts";

const end = Date.UTC(2026, 10, 25, 18, 12);

const record = (overrides: Partial<DriveRecord> = {}): DriveRecord => ({
  driveId: "b".repeat(32),
  start: { time: end - 42 * 60_000, latitude: 51.5, longitude: -0.12 },
  end: { time: end, latitude: 51.55, longitude: -0.07 },
  distance: 22_853,
  checkedDistance: 22_853,
  duration: 42 * 60,
  topSpeed: 25.93,
  averageSpeed: 9,
  utcOffsetMinutes: 0,
  counts: { HARD_BRAKING: 3, RAPID_ACCELERATION: 1, SPEEDING: 2, PHONE_USE: 1 },
  passenger: false,
  speedLimitsChecked: true,
  tellGroup: false,
  events: [],
  ...overrides,
});

const items = (drives: { record: DriveRecord | null; senderUserId?: string }[]) =>
  driveHistoryItems({
    drives: drives.map((drive, index) => ({
      driveId: drive.record?.driveId ?? `unreadable-${index}`,
      record: drive.record,
      senderUserId: drive.senderUserId ?? "sam",
    })),
    nameOf: (userId) => (userId === "sam" ? "Sam" : "Jo"),
    units: { distance: "mi", speed: "mph" },
  });

describe("Drives in Group History", () => {
  test("a finished drive is timed at its end and shows distance, time and top speed, never the score", () => {
    expect(items([{ record: record() }])).toEqual([
      {
        kind: "drive",
        id: `drive:${"b".repeat(32)}`,
        driveId: "b".repeat(32),
        at: new Date(end),
        title: "Sam finished a drive",
        chips: ["14.2 mi", "42 min", "Top 58 mph"],
        note: null,
      },
    ]);
  });

  test("a passenger drive has no numbers and says why", () => {
    const [item] = items([{ record: record({ passenger: true, events: [] }), senderUserId: "jo" }]);

    expect(item?.title).toBe("Jo finished a passenger drive");
    expect(item?.chips).toEqual([]);
    expect(item?.note).toBe("Jo marked it “I was a passenger”, so it has no numbers.");
  });

  test("shows whatever the driver chose for Drive alerts, and skips drives it can't read", () => {
    expect(items([{ record: record({ tellGroup: false }) }, { record: null }])).toHaveLength(1);
  });
});
