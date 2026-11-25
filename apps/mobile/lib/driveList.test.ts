import { describe, expect, test } from "bun:test";
import type { DriveRecord } from "@openbeacon/encryption";
import { driveAt, driveListDays, drivePlaceId } from "./driveList.ts";

const at = (text: string) => new Date(text).getTime();

const drive = ({
  deviceId = "phone",
  end,
  from = { latitude: 51.5, longitude: -0.12 },
  id,
  start,
  to = { latitude: 51.6, longitude: -0.2 },
}: {
  deviceId?: string;
  end: string;
  from?: { latitude: number; longitude: number };
  id: string;
  start: string;
  to?: { latitude: number; longitude: number };
}) => {
  const record: DriveRecord = {
    driveId: id.padEnd(32, "0"),
    start: { time: at(start), ...from },
    end: { time: at(end), ...to },
    distance: 10_000,
    checkedDistance: 10_000,
    duration: (at(end) - at(start)) / 1_000,
    topSpeed: 25,
    averageSpeed: 12,
    utcOffsetMinutes: 0,
    counts: {
      HARD_BRAKING: 0,
      RAPID_ACCELERATION: 0,
      SPEEDING: 0,
      PHONE_USE: 0,
    },
    passenger: false,
    speedLimitsChecked: true,
    tellGroup: true,
    events: [],
  };
  return { driveId: record.driveId, record, senderDeviceId: deviceId };
};

const shell = { latitude: 51.62, longitude: -0.19 };
const places = [
  {
    geometry: {
      latitude: 51.5,
      longitude: -0.12,
      radiusMeters: 150,
      v: 1 as const,
    },
    id: "home",
  },
  { geometry: { ...shell, radiusMeters: 80, v: 1 as const }, id: "shell" },
];

describe("driveListDays", () => {
  test("lists the device's Drives newest first, grouped by the day they started", () => {
    const days = driveListDays({
      deviceId: "phone",
      drives: [
        drive({
          end: "2026-11-23T08:44:00",
          id: "a",
          start: "2026-11-23T08:05:00",
        }),
        drive({
          end: "2026-11-24T18:12:00",
          id: "c",
          start: "2026-11-24T17:30:00",
        }),
        drive({
          end: "2026-11-23T18:20:00",
          id: "b",
          start: "2026-11-23T17:41:00",
        }),
        { driveId: "d".repeat(32), record: null, senderDeviceId: "phone" },
      ],
    });

    expect(days.map((day) => day.key)).toEqual(["2026-11-24", "2026-11-23"]);
    expect(
      days.map((day) => day.items.map((item) => item.kind === "drive" && item.drive.driveId[0])),
    ).toEqual([["c"], ["b", "a"]]);
  });

  test("shows a stop between two Drives split by a short stop in the same spot", () => {
    const [day] = driveListDays({
      deviceId: "phone",
      drives: [
        drive({
          end: "2026-11-24T08:21:00",
          id: "a",
          start: "2026-11-24T07:52:00",
          to: shell,
        }),
        drive({
          end: "2026-11-24T08:58:00",
          from: shell,
          id: "b",
          start: "2026-11-24T08:29:00",
        }),
      ],
      places,
    });

    expect(day?.items.map((item) => item.kind)).toEqual(["drive", "stop", "drive"]);
    expect(day?.items[1]).toEqual({
      kind: "stop",
      minutes: 8,
      placeId: "shell",
    });
  });

  test("shows no stop when the next Drive starts much later or somewhere else", () => {
    const later = driveListDays({
      deviceId: "phone",
      drives: [
        drive({
          end: "2026-11-24T08:21:00",
          id: "a",
          start: "2026-11-24T07:52:00",
          to: shell,
        }),
        drive({
          end: "2026-11-24T10:00:00",
          from: shell,
          id: "b",
          start: "2026-11-24T09:30:00",
        }),
      ],
    });
    const elsewhere = driveListDays({
      deviceId: "phone",
      drives: [
        drive({
          end: "2026-11-24T08:21:00",
          id: "a",
          start: "2026-11-24T07:52:00",
          to: shell,
        }),
        drive({
          end: "2026-11-24T08:58:00",
          id: "b",
          start: "2026-11-24T08:29:00",
        }),
      ],
    });

    expect(later[0]?.items.map((item) => item.kind)).toEqual(["drive", "drive"]);
    expect(elsewhere[0]?.items.map((item) => item.kind)).toEqual(["drive", "drive"]);
  });

  test("counts another device's Drives on the same day so the list can point to them", () => {
    const days = driveListDays({
      deviceId: "phone",
      drives: [
        drive({
          end: "2026-11-24T18:12:00",
          id: "a",
          start: "2026-11-24T17:30:00",
        }),
        drive({
          deviceId: "tablet",
          end: "2026-11-24T12:55:00",
          id: "b",
          start: "2026-11-24T12:40:00",
        }),
        drive({
          deviceId: "tablet",
          end: "2026-11-22T12:55:00",
          id: "c",
          start: "2026-11-22T12:40:00",
        }),
      ],
    });

    expect(days.map((day) => [day.key, day.items.length, day.otherDevices])).toEqual([
      ["2026-11-24", 1, [{ count: 1, deviceId: "tablet" }]],
      ["2026-11-22", 0, [{ count: 1, deviceId: "tablet" }]],
    ]);
  });
});

describe("driveAt", () => {
  test("finds the device's Drive under the scrubber", () => {
    const drives = [
      drive({
        end: "2026-11-24T18:12:00",
        id: "a",
        start: "2026-11-24T17:30:00",
      }),
      drive({
        deviceId: "tablet",
        end: "2026-11-24T17:50:00",
        id: "b",
        start: "2026-11-24T17:40:00",
      }),
    ];
    expect(driveAt(drives, "phone", at("2026-11-24T17:44:00"))?.driveId[0]).toBe("a");
    expect(driveAt(drives, "tablet", at("2026-11-24T17:44:00"))?.driveId[0]).toBe("b");
    expect(driveAt(drives, "phone", at("2026-11-24T18:13:00"))).toBeNull();
  });
});

describe("drivePlaceId", () => {
  test("picks the nearest Place whose circle holds the position", () => {
    expect(drivePlaceId(places, { latitude: 51.5005, longitude: -0.12 })).toBe("home");
    expect(drivePlaceId(places, { latitude: 51.55, longitude: -0.15 })).toBeNull();
  });
});
