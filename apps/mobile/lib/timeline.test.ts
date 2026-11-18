import { describe, expect, test } from "bun:test";
import {
  buildTimeline,
  pickPersonDevices,
  timelineDayStats,
  timelinePositionAt,
} from "./timeline.ts";
import type { TimelineDeviceData, TimelinePoint } from "./timelineTypes.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const dayStart = Date.parse("2026-07-14T00:00:00Z");
const day = { end: dayStart + 24 * HOUR_MS, key: "2026-07-14", start: dayStart };
const at = (hours: number, minutes = 0) => dayStart + hours * HOUR_MS + minutes * MINUTE_MS;

const point = ({
  latitude = 51.5,
  longitude = -0.12,
  revisionPrefix = "rev-1",
  stayUntil = null,
  streamId = "stream-1",
  time,
}: {
  latitude?: number;
  longitude?: number;
  revisionPrefix?: string;
  stayUntil?: number | null;
  streamId?: string;
  time: number;
}): TimelinePoint => ({
  accuracy: 5,
  battery: { charging: false, level: 50 },
  latitude,
  longitude,
  pointId: String(time),
  revisionPrefix,
  speed: null,
  stayUntil,
  streamId,
  time,
});

const device = (points: TimelinePoint[], deviceId = "phone"): TimelineDeviceData => ({
  deviceId,
  points,
  undecryptable: 0,
  userId: "alice",
});

const segmentsOf = (
  points: TimelinePoint[],
  options: { joinStart?: number | null; now?: number; windowStart?: number } = {},
) =>
  buildTimeline({
    day,
    devices: [device(points)],
    joinStart: options.joinStart ?? null,
    now: options.now ?? day.end + HOUR_MS,
    windowStart: options.windowStart ?? dayStart - 14 * 24 * HOUR_MS,
  }).devices[0]?.segments ?? [];

const kinds = (points: TimelinePoint[], options?: Parameters<typeof segmentsOf>[1]) =>
  segmentsOf(points, options).map(({ end, kind, start }) => [
    kind,
    (start - dayStart) / MINUTE_MS,
    (end - dayStart) / MINUTE_MS,
  ]);

describe("buildTimeline", () => {
  test("a change of sharing revision is a pause from the last point to the first after it", () => {
    expect(
      kinds([
        point({ time: at(10) }),
        point({ time: at(10, 2) }),
        point({ revisionPrefix: "rev-2", streamId: "stream-2", time: at(11) }),
      ]),
    ).toEqual([
      ["noLocation", 0, 600],
      ["moving", 600, 602],
      ["pause", 602, 660],
      ["noLocation", 660, 1440],
    ]);
  });

  test("an epoch rotation keeps the revision, so it isn't a pause", () => {
    expect(
      kinds([
        point({ time: at(10) }),
        point({ streamId: "stream-2", time: at(10, 3) }),
        point({ streamId: "stream-3", time: at(10, 30) }),
      ]),
    ).toEqual([
      ["noLocation", 0, 600],
      ["moving", 600, 603],
      ["noLocation", 603, 630],
      ["noLocation", 630, 1440],
    ]);
  });

  test("a pause after a stay starts when the stay ends", () => {
    const segments = segmentsOf([
      point({ stayUntil: at(10), time: at(9) }),
      point({ latitude: 51.6, revisionPrefix: "rev-2", time: at(12) }),
    ]);

    expect(segments.slice(1, 3)).toEqual([
      {
        end: at(10),
        kind: "stay",
        position: { accuracy: 5, latitude: 51.5, longitude: -0.12 },
        start: at(9),
      },
      {
        end: at(12),
        from: { accuracy: 5, latitude: 51.5, longitude: -0.12 },
        kind: "pause",
        start: at(10),
        to: { accuracy: 5, latitude: 51.6, longitude: -0.12 },
      },
    ]);
  });

  test("a stay from the lookback point covers the morning", () => {
    const points = [
      point({ stayUntil: at(8), time: at(-4) }),
      point({ latitude: 51.501, time: at(8, 5) }),
    ];

    expect(kinds(points)).toEqual([
      ["stay", 0, 480],
      ["moving", 480, 485],
      ["noLocation", 485, 1440],
    ]);
    expect(timelinePositionAt(segmentsOf(points), at(3))).toEqual({
      position: { accuracy: 5, latitude: 51.5, longitude: -0.12 },
      state: "stay",
    });
  });

  test("a stay ends at the next point when its until-time runs past it", () => {
    expect(
      kinds([point({ stayUntil: at(11), time: at(9) }), point({ latitude: 51.6, time: at(10) })]),
    ).toEqual([
      ["noLocation", 0, 540],
      ["stay", 540, 600],
      ["noLocation", 600, 1440],
    ]);
  });

  test("a stay that ends before its own time covers nothing and segments never overlap", () => {
    const points = [
      point({ time: at(9) }),
      point({ latitude: 51.501, stayUntil: at(8), time: at(9, 5) }),
      point({ latitude: 51.502, time: at(9, 8) }),
    ];

    expect(kinds(points)).toEqual([
      ["noLocation", 0, 540],
      ["moving", 540, 545],
      ["moving", 545, 548],
      ["noLocation", 548, 1440],
    ]);
    expect(timelinePositionAt(segmentsOf(points), at(9, 6))).toMatchObject({ state: "moving" });
  });

  test("orders points by time and skips zero-length gaps between points at the same time", () => {
    const segments = segmentsOf([
      point({ latitude: 51.502, time: at(9, 10) }),
      point({ time: at(9) }),
      point({ latitude: 51.501, stayUntil: at(9, 5), time: at(9) }),
    ]);

    expect(
      segments.map(({ end, kind, start }) => [
        kind,
        (start - dayStart) / MINUTE_MS,
        (end - dayStart) / MINUTE_MS,
      ]),
    ).toEqual([
      ["noLocation", 0, 540],
      ["stay", 540, 545],
      ["moving", 545, 550],
      ["noLocation", 550, 1440],
    ]);
    for (const segment of segments) expect(segment.end).toBeGreaterThan(segment.start);
    segments.slice(1).forEach((segment, index) => {
      expect(segment.start).toBe(segments[index]?.end ?? Number.NaN);
    });
  });

  test("more than 10 minutes without a point is no location, 10 minutes or less is moving", () => {
    expect(
      kinds([point({ time: at(10) }), point({ time: at(10, 10) }), point({ time: at(10, 21) })]),
    ).toEqual([
      ["noLocation", 0, 600],
      ["moving", 600, 610],
      ["noLocation", 610, 621],
      ["noLocation", 621, 1440],
    ]);
  });

  test("clips a moving segment to the day and interpolates its ends", () => {
    const segments = segmentsOf([
      point({ latitude: 51, time: at(0, -5) }),
      point({ latitude: 52, time: at(0, 5) }),
    ]);

    expect(segments[0]).toEqual({
      end: at(0, 5),
      from: { accuracy: 5, latitude: 51.5, longitude: -0.12 },
      kind: "moving",
      start: dayStart,
      to: { accuracy: 5, latitude: 52, longitude: -0.12 },
    });
  });

  test("clips to the history window and to now", () => {
    const points = [point({ stayUntil: at(20), time: at(2) })];

    expect(kinds(points, { now: at(12), windowStart: at(6) })).toEqual([["stay", 360, 720]]);
    expect(kinds(points, { joinStart: at(7), now: at(12), windowStart: at(6) })).toEqual([
      ["stay", 420, 720],
    ]);
    expect(
      buildTimeline({
        day,
        devices: [device(points)],
        joinStart: at(7),
        now: at(12),
        windowStart: at(6),
      }),
    ).toMatchObject({ from: at(7), historyStart: at(7), to: at(12) });
    expect(
      kinds(points, { joinStart: at(-30), windowStart: at(-24 * 13) }).map(([kind]) => kind),
    ).toEqual(["noLocation", "stay", "noLocation"]);
  });

  test("a day wholly before the window has no segments", () => {
    expect(kinds([point({ time: at(10) })], { windowStart: day.end })).toEqual([]);
  });

  test("a device with no points that day has no location all day", () => {
    expect(kinds([])).toEqual([["noLocation", 0, 1440]]);
  });

  test("each person's own history window shades and clips only their lane", () => {
    const timeline = buildTimeline({
      day,
      devices: [
        { ...device([point({ time: at(8) }), point({ time: at(20) })]), userId: "sam" },
        {
          ...device([point({ time: at(8) }), point({ time: at(20) })]),
          deviceId: "b",
          userId: "bea",
        },
        { ...device([]), deviceId: "c", userId: "cal" },
      ],
      joinStart: null,
      now: at(22),
      senders: [
        { userId: "sam", firstHour: at(17) / HOUR_MS },
        { userId: "bea", firstHour: null },
        { userId: "cal", firstHour: at(23) / HOUR_MS },
      ],
      windowStart: dayStart - 14 * 24 * HOUR_MS,
    });
    const [sam, bea, cal] = timeline.devices;
    expect(timeline.historyStart).toBe(dayStart - 14 * 24 * HOUR_MS);
    expect(sam?.historyStart).toBe(at(17));
    expect(sam?.segments[0]?.start).toBe(at(17));
    expect(sam?.segments.some((segment) => segment.start < at(17))).toBe(false);
    expect(bea?.historyStart).toBe(timeline.historyStart);
    expect(bea?.segments[0]?.start).toBe(dayStart);
    expect(cal?.historyStart).toBe(at(23));
    expect(cal?.segments).toEqual([]);
  });

  test("a first location within 10 minutes of the start isn't shown as no location", () => {
    expect(kinds([point({ time: at(0, 0.5) }), point({ time: at(0, 2) })]).slice(0, 2)).toEqual([
      ["moving", 0.5, 2],
      ["noLocation", 2, 1440],
    ]);
    expect(kinds([point({ time: at(0, 11) }), point({ time: at(0, 12) })])[0]).toEqual([
      "noLocation",
      0,
      11,
    ]);
  });

  test("a night at home split into hourly parts plays as one stop from the start of the window", () => {
    const home = { latitude: 51.5, longitude: -0.12 };
    const parts = [17, 18, 19].map((hour) =>
      point({ ...home, stayUntil: at(hour + 1), streamId: `stay-${hour}`, time: at(hour) }),
    );
    const timeline = buildTimeline({
      day,
      devices: [{ ...device(parts), userId: "sam" }],
      joinStart: null,
      now: at(20),
      senders: [{ userId: "sam", firstHour: at(17) / HOUR_MS }],
      windowStart: dayStart - 14 * 24 * HOUR_MS,
    });
    const segments = timeline.devices[0]?.segments ?? [];
    expect(segments.map(({ kind, start }) => [kind, (start - dayStart) / MINUTE_MS])).toEqual([
      ["stay", 17 * 60],
      ["stay", 18 * 60],
      ["stay", 19 * 60],
    ]);
    expect(timelineDayStats({ places: [], segments }).stops).toEqual([
      { end: at(20), placeId: null, position: { accuracy: 5, ...home }, start: at(17) },
    ]);
  });

  test("counts only points timed inside the day", () => {
    const timeline = buildTimeline({
      day,
      devices: [device([point({ time: at(-1) }), point({ time: at(1) }), point({ time: at(25) })])],
      joinStart: null,
      now: day.end,
      windowStart: dayStart,
    });
    expect(timeline.devices[0]?.pointCount).toBe(1);
  });
});

describe("pickPersonDevices", () => {
  test("picks the device with the most points that day and lists the others", () => {
    const tablet = { deviceId: "tablet", pointCount: 40, userId: "alice" };
    const phone = { deviceId: "phone", pointCount: 300, userId: "alice" };
    const watch = { deviceId: "watch", pointCount: 0, userId: "alice" };
    const devices = [
      tablet,
      phone,
      { deviceId: "bob-phone", pointCount: 900, userId: "bob" },
      watch,
    ];

    expect(pickPersonDevices(devices, "alice")).toEqual({
      others: [tablet, watch],
      selected: phone,
    });
    expect(pickPersonDevices(devices, "carol")).toBeNull();
  });

  test("breaks a tie by device ID so the choice is stable", () => {
    const devices = [
      { deviceId: "b", pointCount: 5, userId: "alice" },
      { deviceId: "a", pointCount: 5, userId: "alice" },
    ];
    expect(pickPersonDevices(devices, "alice")?.selected.deviceId).toBe("a");
  });
});

describe("timelinePositionAt", () => {
  const segments = segmentsOf([
    point({ latitude: 51, time: at(10) }),
    point({ latitude: 52, time: at(10, 10) }),
    point({ latitude: 52, revisionPrefix: "rev-2", stayUntil: at(12), time: at(11) }),
  ]);

  test("interpolates while moving, including at the segment's ends", () => {
    expect(timelinePositionAt(segments, at(10))).toMatchObject({
      position: { latitude: 51 },
      state: "moving",
    });
    expect(timelinePositionAt(segments, at(10, 5))).toMatchObject({
      position: { latitude: 51.5 },
      state: "moving",
    });
    expect(timelinePositionAt(segments, at(10, 10))).toMatchObject({
      position: { latitude: 52 },
      state: "moving",
    });
  });

  test("stays at the last position before a pause", () => {
    expect(timelinePositionAt(segments, at(10, 30))).toMatchObject({
      position: { latitude: 52 },
      state: "pause",
    });
  });

  test("holds the stay's position, and shows it at the stay's start", () => {
    expect(timelinePositionAt(segments, at(11))).toMatchObject({
      position: { latitude: 52 },
      state: "stay",
    });
    expect(timelinePositionAt(segments, at(12))).toMatchObject({ state: "stay" });
  });

  test("has no position before the first point, after the stay or outside the day", () => {
    expect(timelinePositionAt(segments, at(9))).toEqual({ position: null, state: "noLocation" });
    expect(timelinePositionAt(segments, at(12, 1))).toEqual({
      position: null,
      state: "noLocation",
    });
    expect(timelinePositionAt(segments, day.end + 1)).toEqual({
      position: null,
      state: "noLocation",
    });
    expect(timelinePositionAt([], at(9))).toEqual({ position: null, state: "noLocation" });
  });
});

describe("timelineDayStats", () => {
  const home = {
    geometry: { latitude: 51.5, longitude: -0.12, radiusMeters: 200, v: 1 as const },
    id: "home",
  };
  const school = {
    geometry: { latitude: 51.51, longitude: -0.12, radiusMeters: 100, v: 1 as const },
    id: "school",
  };

  test("adds up distance and time moving, and marks stops inside places", () => {
    const segments = segmentsOf([
      point({ stayUntil: at(8), time: at(-4) }),
      point({ latitude: 51.505, time: at(8, 5) }),
      point({ latitude: 51.51, stayUntil: at(15), time: at(8, 10) }),
      point({ latitude: 51.52, time: at(15, 5) }),
      point({ latitude: 51.53, stayUntil: at(16), time: at(15, 10) }),
    ]);

    const stats = timelineDayStats({
      places: [home, school, { geometry: null, id: "x" }],
      segments,
    });

    expect(stats.movingMs).toBe(20 * MINUTE_MS);
    expect(stats.distanceMeters).toBeCloseTo(3_335.85, 0);
    expect(stats.stops.map(({ end, placeId, start }) => [placeId, start, end])).toEqual([
      ["home", dayStart, at(8)],
      ["school", at(8, 10), at(15)],
      [null, at(15, 10), at(16)],
    ]);
  });

  test("joins a stay split across streams into one stop, but not across a gap", () => {
    const split = segmentsOf([
      point({ stayUntil: at(10), time: at(9) }),
      point({ streamId: "stream-2", stayUntil: at(11), time: at(10, 1) }),
    ]);
    expect(timelineDayStats({ places: [], segments: split }).stops).toMatchObject([
      { end: at(11), start: at(9) },
    ]);

    const apart = segmentsOf([
      point({ stayUntil: at(10), time: at(9) }),
      point({ streamId: "stream-2", stayUntil: at(11), time: at(10, 30) }),
    ]);
    expect(timelineDayStats({ places: [], segments: apart }).stops).toHaveLength(2);
  });
});
