import { describe, expect, test } from "bun:test";
import type { DriveRecord } from "@openbeacon/encryption";
import { driveAlertsToShow } from "./driveAlerts.ts";

const now = Date.UTC(2026, 10, 25, 18, 30);
const MINUTE = 60_000;

const record = (overrides: Partial<DriveRecord> = {}): DriveRecord => ({
  driveId: "a".repeat(32),
  start: { time: now - 32 * MINUTE, latitude: 51.5, longitude: -0.12 },
  end: { time: now - 10 * MINUTE, latitude: 51.55, longitude: -0.07 },
  distance: 14_000,
  checkedDistance: 14_000,
  duration: 22 * 60,
  topSpeed: 27.27,
  averageSpeed: 10.6,
  utcOffsetMinutes: 0,
  counts: { HARD_BRAKING: 2, RAPID_ACCELERATION: 0, SPEEDING: 1, PHONE_USE: 1 },
  passenger: false,
  speedLimitsChecked: true,
  tellGroup: true,
  events: [],
  ...overrides,
});

const show = (
  copies: { groupId: string; record: DriveRecord }[],
  { shown = new Set<string>(), at = now } = {},
) =>
  driveAlertsToShow({
    copies: copies.map((copy) => ({
      ...copy,
      driveId: copy.record.driveId,
      senderUserId: "alex",
    })),
    nameOf: () => "Alex",
    now: at,
    shown,
    units: { distance: "km", speed: "mph" },
  });

describe("Drive alerts", () => {
  test("say the distance, time and top speed of a drive that just ended, never the score or events", () => {
    expect(show([{ groupId: "family", record: record() }])).toEqual([
      {
        driveId: "a".repeat(32),
        groupId: "family",
        userId: "alex",
        title: "Alex finished a 14.0 km drive",
        body: "22 min · top 61 mph",
      },
    ]);
  });

  test("only alert for drives that ended in the last 30 minutes", () => {
    const ended = (minutesAgo: number) =>
      show([
        {
          groupId: "family",
          record: record({
            end: { ...record().end, time: now - minutesAgo * MINUTE },
          }),
        },
      ]);

    expect(ended(29)).toHaveLength(1);
    expect(ended(30)).toHaveLength(1);
    expect(ended(31)).toEqual([]);
  });

  test("a passenger mark that arrived first turns the alert into one with no numbers", () => {
    const [alert] = show([{ groupId: "family", record: record({ passenger: true, events: [] }) }]);

    expect(alert?.title).toBe("Alex finished a passenger drive");
    expect(alert?.body).toBeNull();
  });

  test("a Group the driver doesn't tell gets nothing, but another Group they do tell still alerts once", () => {
    const quiet = record({ tellGroup: false });

    expect(show([{ groupId: "work", record: quiet }])).toEqual([]);
    expect(
      show([
        { groupId: "work", record: quiet },
        { groupId: "family", record: record() },
      ]).map(({ groupId }) => groupId),
    ).toEqual(["family"]);
  });

  test("a drive already alerted, or the same drive in a second Group, never alerts again", () => {
    const drive = record();

    expect(
      show([
        { groupId: "family", record: drive },
        { groupId: "work", record: drive },
      ]),
    ).toHaveLength(1);
    expect(
      show([{ groupId: "family", record: drive }], {
        shown: new Set([drive.driveId]),
      }),
    ).toEqual([]);
  });
});
