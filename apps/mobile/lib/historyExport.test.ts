import { describe, expect, test } from "bun:test";
import {
  encodeTrackingPoint,
  encryptGroupPayload,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  TRACKING_POINT_KIND,
  type TrackingPoint,
} from "@openbeacon/encryption";
import { TRPCClientError } from "@trpc/client";
import type { RouterInputs, RouterOutputs } from "./api.ts";
import {
  buildHistoryGpx,
  buildHistoryJson,
  historyExportWindows,
  loadOwnHistory,
} from "./historyExport.ts";

type RangePage = RouterOutputs["groupTracking"]["historyRange"];
type EpochWraps = RouterOutputs["groupEpoch"]["listEpochKeyWraps"];

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;
const start = Date.parse("2026-11-10T00:00:00Z");
const startHour = start / HOUR_MS;

const trackingPoint = (time: number, overrides: Partial<TrackingPoint> = {}): TrackingPoint => ({
  accuracy: 8,
  battery: { charging: false, level: 60 },
  latitude: 51.5,
  longitude: -0.12,
  speed: 2,
  stayUntil: null,
  time,
  ...overrides,
});

const exportPoint = (
  time: number,
  overrides: Partial<TrackingPoint> = {},
  revisionPrefix = "a",
) => ({
  ...trackingPoint(time, overrides),
  revisionPrefix,
});

const fakeGroup = ({
  groupId,
  epochKey,
  points,
}: {
  groupId: string;
  epochKey: EpochKeyMaterial | null;
  points: Array<{ deviceId: string; point: TrackingPoint; userId: string }>;
}) => {
  const usedKey = epochKey ?? generateGroupEpochKey();
  const streamIds = new Map<string, string>();
  const streams: RangePage["streams"] = [];
  const encrypted = points.map(({ deviceId, point, userId }, index) => {
    let streamId = streamIds.get(deviceId);
    if (!streamId) {
      streamId = String(streamIds.size + 1);
      streamIds.set(deviceId, streamId);
      streams.push({
        epochId: `${groupId}-epoch`,
        epochNumber: 1,
        id: streamId,
        revisionPrefix: "a",
        senderDeviceId: deviceId,
        senderUserId: userId,
      });
    }
    const sealed = encryptGroupPayload({
      epochId: `${groupId}-epoch`,
      epochKey: usedKey,
      groupId,
      kind: TRACKING_POINT_KIND,
      payload: encodeTrackingPoint(point),
      senderDeviceId: deviceId,
    });
    return {
      capturedHour: Math.floor(point.time / HOUR_MS),
      ciphertext: sealed.ciphertext,
      nonce: sealed.nonce,
      pointId: String(index + 1),
      streamId,
      userId,
    };
  });
  const devices = new Map<string, { hours: Map<number, number>; userId: string }>();
  for (const { deviceId, point, userId } of points) {
    const device = devices.get(deviceId) ?? { hours: new Map(), userId };
    const hour = Math.floor(point.time / HOUR_MS);
    device.hours.set(hour, (device.hours.get(hour) ?? 0) + 1);
    devices.set(deviceId, device);
  }
  return {
    days: {
      devices: [...devices].map(([senderDeviceId, { hours, userId }]) => ({
        firstHour: Math.min(...hours.keys()),
        hours: [...hours].map(([hour, count]) => ({ count, hour })),
        senderDeviceId,
        senderUserId: userId,
      })),
      senders: [],
      windowStart: new Date(start - 30 * 24 * HOUR_MS),
    } satisfies RouterOutputs["groupTracking"]["historyDays"],
    epochKey,
    groupId,
    range: (input: RouterInputs["groupTracking"]["historyRange"]): RangePage => {
      const wanted = encrypted.filter(
        (point) => point.capturedHour >= input.fromHour && point.capturedHour < input.toHour,
      );
      const streamIdsInPage = new Set(wanted.map(({ streamId }) => streamId));
      return {
        cursor: null,
        hasMore: false,
        lookback: [],
        points: wanted.map(({ userId: _userId, ...point }) => point),
        streams: streams.filter(({ id }) => streamIdsInPage.has(id)),
      };
    },
  };
};

const epochPage = (groupId: string): EpochWraps => ({
  epochs: [
    {
      createdAt: new Date(start - 40 * 24 * HOUR_MS),
      deviceWrap: null,
      epochId: `${groupId}-epoch`,
      epochNumber: 1,
      historyWraps: [],
    },
  ],
  nextCursor: null,
});

const groupById = <T extends { groupId: string }>(groups: readonly T[], groupId: string) => {
  const group = groups.find((candidate) => candidate.groupId === groupId);
  if (!group) throw new Error("Unknown group");
  return group;
};

const sharedKey = generateGroupEpochKey();

const myPointsGroup = (groupId: string, times: readonly number[]) =>
  fakeGroup({
    epochKey: sharedKey,
    groupId,
    points: times.map((time) => ({
      deviceId: "my-phone",
      point: trackingPoint(time),
      userId: "me",
    })),
  });

const baseInput = (
  groups: ReadonlyArray<ReturnType<typeof fakeGroup>>,
): Parameters<typeof loadOwnHistory>[0] => ({
  deviceNames: new Map([["my-phone", "Pixel"]]),
  fetchRange: async (input) => groupById(groups, input.groupId).range(input),
  groupIds: groups.map(({ groupId }) => groupId),
  historyDays: async (groupId) => groupById(groups, groupId).days,
  listEpochs: async (groupId) => epochPage(groupId),
  signal: new AbortController().signal,
  unwrapEpoch: async () => sharedKey,
  userId: "me",
  wait: async () => {},
  yieldToUi: async () => {},
});

const rateLimited = () =>
  TRPCClientError.from({
    error: {
      code: -32029,
      data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 },
      message: "Too many requests.",
    },
  });

describe("historyExportWindows", () => {
  test("groups recorded hours into windows of at most 24 hours and skips empty stretches", () => {
    const windows = historyExportWindows([
      startHour + 30,
      startHour,
      startHour + 23,
      startHour + 24,
      startHour,
      startHour + 100,
    ]);
    expect(windows.map(({ start, end }) => [start / HOUR_MS, end / HOUR_MS])).toEqual([
      [startHour, startHour + 24],
      [startHour + 24, startHour + 31],
      [startHour + 100, startHour + 101],
    ]);
    for (const window of windows)
      expect(window.end - window.start).toBeLessThanOrEqual(24 * HOUR_MS);
  });

  test("has no windows without any hours", () => {
    expect(historyExportWindows([])).toEqual([]);
  });
});

describe("loadOwnHistory", () => {
  test("decrypts only my own devices' points, merges copies from every group and keeps the longest stay", async () => {
    const familyKey = generateGroupEpochKey();
    const friendsKey = generateGroupEpochKey();
    const stayStart = start + 2 * HOUR_MS;
    const family = fakeGroup({
      epochKey: familyKey,
      groupId: "family",
      points: [
        {
          deviceId: "my-phone",
          point: trackingPoint(start + HOUR_MS),
          userId: "me",
        },
        {
          deviceId: "my-phone",
          point: trackingPoint(stayStart, {
            stayUntil: stayStart + 20 * MINUTE_MS,
          }),
          userId: "me",
        },
        {
          deviceId: "their-phone",
          point: trackingPoint(start + HOUR_MS),
          userId: "them",
        },
        {
          deviceId: "my-old-phone",
          point: trackingPoint(start + 3 * HOUR_MS),
          userId: "me",
        },
      ],
    });
    const friends = fakeGroup({
      epochKey: friendsKey,
      groupId: "friends",
      points: [
        {
          deviceId: "my-phone",
          point: trackingPoint(stayStart, {
            stayUntil: stayStart + 45 * MINUTE_MS,
          }),
          userId: "me",
        },
        {
          deviceId: "my-tablet",
          point: trackingPoint(start + 50 * HOUR_MS),
          userId: "me",
        },
      ],
    });
    const groups = new Map([
      ["family", family],
      ["friends", friends],
    ]);
    const requests: Array<RouterInputs["groupTracking"]["historyRange"]> = [];
    const epochListings: string[] = [];
    const unwraps: string[] = [];
    const progress: Array<{ done: number; total: number }> = [];

    const result = await loadOwnHistory({
      deviceNames: new Map([
        ["my-phone", "Pixel"],
        ["my-tablet", "Tab"],
      ]),
      fetchRange: async (input) => {
        requests.push(input);
        const group = groups.get(input.groupId);
        if (!group) throw new Error("Unknown group");
        return group.range(input);
      },
      groupIds: ["family", "friends"],
      historyDays: async (groupId) => {
        const group = groups.get(groupId);
        if (!group) throw new Error("Unknown group");
        return group.days;
      },
      listEpochs: async (groupId) => {
        epochListings.push(groupId);
        return epochPage(groupId);
      },
      onProgress: (value) => progress.push(value),
      signal: new AbortController().signal,
      unwrapEpoch: async (epoch) => {
        unwraps.push(epoch.epochId);
        return epoch.epochId === "family-epoch" ? familyKey : friendsKey;
      },
      userId: "me",
      wait: async () => {},
      yieldToUi: async () => {},
    });

    expect(result.undecryptable).toBe(false);
    expect(result.failedGroups).toBe(0);
    expect(result.devices.map(({ deviceId, name }) => [deviceId, name])).toEqual([
      ["my-phone", "Pixel"],
      ["my-tablet", "Tab"],
    ]);
    expect(result.devices[0]?.points.map(({ time, stayUntil }) => [time, stayUntil])).toEqual([
      [start + HOUR_MS, null],
      [stayStart, stayStart + 45 * MINUTE_MS],
    ]);
    expect(result.devices[1]?.points.map(({ time }) => time)).toEqual([start + 50 * HOUR_MS]);
    expect(requests.every((request) => !("onlyMine" in request))).toBe(true);
    expect(requests.every((request) => request.toHour - request.fromHour <= 26)).toBe(true);
    expect(epochListings).toEqual(["family", "friends"]);
    expect(unwraps).toEqual(["family-epoch", "friends-epoch"]);
    expect(progress.at(0)).toEqual({ done: 0, total: 3 });
    expect(progress.at(-1)).toEqual({ done: 3, total: 3 });
  });

  test("reports points this phone can't decrypt and leaves them out", async () => {
    const group = fakeGroup({
      epochKey: null,
      groupId: "family",
      points: [{ deviceId: "my-phone", point: trackingPoint(start), userId: "me" }],
    });
    const result = await loadOwnHistory({
      ...baseInput([group]),
      unwrapEpoch: async () => null,
    });
    expect(result).toEqual({
      devices: [],
      failedGroups: 0,
      undecryptable: true,
    });
  });

  test("merges the same stay recorded slightly differently in two groups and keeps other stays apart", async () => {
    const familyKey = generateGroupEpochKey();
    const friendsKey = generateGroupEpochKey();
    const stay = (time: number, minutes: number, latitude = 51.5) => ({
      deviceId: "my-phone",
      point: trackingPoint(time, {
        latitude,
        speed: 0,
        stayUntil: time + minutes * MINUTE_MS,
      }),
      userId: "me",
    });
    const family = fakeGroup({
      epochKey: familyKey,
      groupId: "family",
      points: [stay(start, 30), stay(start + 5 * HOUR_MS, 30)],
    });
    const friends = fakeGroup({
      epochKey: friendsKey,
      groupId: "friends",
      points: [
        stay(start + 2 * MINUTE_MS, 45, 51.5003),
        stay(start + 10 * MINUTE_MS, 10, 51.52),
        stay(start + 5 * HOUR_MS + 40 * MINUTE_MS, 30),
      ],
    });
    const result = await loadOwnHistory({
      ...baseInput([family, friends]),
      unwrapEpoch: async (epoch) => (epoch.epochId === "family-epoch" ? familyKey : friendsKey),
    });
    expect(
      result.devices[0]?.points.map(({ latitude, stayUntil, time }) => [time, stayUntil, latitude]),
    ).toEqual([
      [start, start + 47 * MINUTE_MS, 51.5],
      [start + 10 * MINUTE_MS, start + 20 * MINUTE_MS, 51.52],
      [start + 5 * HOUR_MS, start + 5 * HOUR_MS + 30 * MINUTE_MS, 51.5],
      [start + 5 * HOUR_MS + 40 * MINUTE_MS, start + 5 * HOUR_MS + 70 * MINUTE_MS, 51.5],
    ]);
  });

  test("skips and counts groups that fail without losing the others", async () => {
    const family = myPointsGroup("family", [start]);
    const friends = myPointsGroup("friends", [start]);
    const work = myPointsGroup("work", [start, start + 30 * HOUR_MS]);
    let workRanges = 0;
    const result = await loadOwnHistory({
      ...baseInput([family, friends, work]),
      fetchRange: async (input) => {
        if (input.groupId === "work" && ++workRanges === 2) throw new Error("Server error");
        return groupById([family, friends, work], input.groupId).range(input);
      },
      historyDays: async (groupId) => {
        if (groupId === "friends") throw new Error("Server error");
        return groupById([family, friends, work], groupId).days;
      },
    });
    expect(result.failedGroups).toBe(2);
    expect(result.devices.map(({ points }) => points.map(({ time }) => time))).toEqual([[start]]);
  });

  test("waits and retries a rate-limited window", async () => {
    const family = myPointsGroup("family", [start]);
    const waits: number[] = [];
    let calls = 0;
    const result = await loadOwnHistory({
      ...baseInput([family]),
      fetchRange: async (input) => {
        calls += 1;
        if (calls === 1) throw rateLimited();
        return family.range(input);
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([20_000]);
    expect(result.failedGroups).toBe(0);
    expect(result.devices[0]?.points.map(({ time }) => time)).toEqual([start]);
  });

  test("counts a group as failed once the rate-limit retries run out", async () => {
    const family = myPointsGroup("family", [start]);
    const waits: number[] = [];
    let calls = 0;
    const result = await loadOwnHistory({
      ...baseInput([family]),
      fetchRange: async () => {
        calls += 1;
        throw rateLimited();
      },
      wait: async (ms) => {
        waits.push(ms);
      },
    });
    expect(calls).toBe(3);
    expect(waits).toEqual([20_000, 40_000]);
    expect(result).toEqual({
      devices: [],
      failedGroups: 1,
      undecryptable: false,
    });
  });

  test("rejects as soon as it is cancelled during a rate-limit wait", async () => {
    const family = myPointsGroup("family", [start]);
    const controller = new AbortController();
    const result = loadOwnHistory({
      ...baseInput([family]),
      fetchRange: async () => {
        throw rateLimited();
      },
      signal: controller.signal,
      wait: () => {
        controller.abort();
        return new Promise(() => {});
      },
    });
    await expect(result).rejects.toThrow("cancelled");
  });

  test("rejects when cancelled after the first window and reports no more progress", async () => {
    const family = myPointsGroup("family", [start, start + 30 * HOUR_MS, start + 60 * HOUR_MS]);
    const controller = new AbortController();
    const progress: number[] = [];
    let ranges = 0;
    const result = loadOwnHistory({
      ...baseInput([family]),
      fetchRange: async (input) => {
        ranges += 1;
        return family.range(input);
      },
      onProgress: ({ done }) => {
        progress.push(done);
        if (done === 1) controller.abort();
      },
      signal: controller.signal,
    });
    await expect(result).rejects.toThrow("cancelled");
    expect(progress).toEqual([0, 1]);
    expect(ranges).toBe(1);
  });
});

describe("buildHistoryGpx", () => {
  test("writes one track per device, holds stays until they end and breaks segments on gaps and pauses", () => {
    const gpx = buildHistoryGpx({
      devices: [
        {
          deviceId: "my-phone",
          name: "Sam's <Pixel> & co",
          points: [
            exportPoint(start, { stayUntil: start + 30 * MINUTE_MS }),
            exportPoint(start + 32 * MINUTE_MS, { latitude: 51.6 }),
            exportPoint(start + 60 * MINUTE_MS, { latitude: 51.7 }),
            exportPoint(start + 62 * MINUTE_MS, { latitude: 51.8 }, "b"),
          ],
        },
      ],
      exportedAt: start + 2 * HOUR_MS,
    });
    expect(gpx).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx).toContain("<name>Sam&apos;s &lt;Pixel&gt; &amp; co</name>");
    const segments = [...gpx.matchAll(/<trkseg>([\s\S]*?)<\/trkseg>/g)].map((match) =>
      [...(match[1] ?? "").matchAll(/lat="([^"]+)".*?<time>([^<]+)<\/time>/g)].map(
        ([, lat, time]) => `${lat}@${time?.slice(11, 16)}`,
      ),
    );
    expect(segments).toEqual([
      ["51.5000000@00:00", "51.5000000@00:30", "51.6000000@00:32"],
      ["51.7000000@01:00"],
      ["51.8000000@01:02"],
    ]);
  });

  test("never writes coordinates in exponent notation", () => {
    const gpx = buildHistoryGpx({
      devices: [
        {
          deviceId: "my-phone",
          name: "Pixel",
          points: [exportPoint(start, { latitude: -1e-7, longitude: 5e-7 })],
        },
      ],
      exportedAt: start,
    });
    expect(gpx).toContain('lat="-0.0000001" lon="0.0000005"');
    expect(gpx).not.toMatch(/\de-\d/);
  });
});

describe("buildHistoryJson", () => {
  test("names every field with its unit and uses ISO times", () => {
    const json = JSON.parse(
      buildHistoryJson({
        devices: [
          {
            deviceId: "my-phone",
            name: "Pixel",
            points: [
              exportPoint(start, {
                accuracy: null,
                battery: { charging: true, level: null },
                stayUntil: start + 5 * MINUTE_MS,
              }),
            ],
          },
        ],
        exportedAt: start,
      }),
    );
    expect(json).toEqual({
      devices: [
        {
          id: "my-phone",
          name: "Pixel",
          points: [
            {
              accuracyMetres: null,
              batteryPercent: null,
              charging: true,
              latitude: 51.5,
              longitude: -0.12,
              speedMetresPerSecond: 2,
              stayedUntil: "2026-11-10T00:05:00.000Z",
              time: "2026-11-10T00:00:00.000Z",
            },
          ],
        },
      ],
      exportedAt: "2026-11-10T00:00:00.000Z",
      format: "openbeacon-location-history",
      version: 1,
    });
  });
});
