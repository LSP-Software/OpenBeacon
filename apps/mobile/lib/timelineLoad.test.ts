import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  encodeTrackingPoint,
  encryptGroupPayload,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  TRACKING_POINT_KIND,
  type TrackingPoint,
} from "@openbeacon/encryption";
import type { RouterInputs, RouterOutputs } from "./api.ts";
import { buildTimeline, timelinePositionAt } from "./timeline.ts";
import { loadTimelineDay } from "./timelineLoad.ts";

type RangePage = RouterOutputs["groupTracking"]["historyRange"];
type EpochWraps = RouterOutputs["groupEpoch"]["listEpochKeyWraps"];

const HOUR_MS = 60 * 60_000;
const dayStart = Date.parse("2026-07-14T00:00:00Z");
const day = { end: dayStart + 24 * HOUR_MS, key: "2026-07-14", start: dayStart };
const groupId = "group-1";

const vectors = JSON.parse(
  readFileSync(
    new URL("../../../packages/encryption/src/testVectors/tracking-point-v2.json", import.meta.url),
    "utf8",
  ),
) as { encode: Array<{ decoded: TrackingPoint; hex: string; name: string }> };
const vector = (name: string) => {
  const found = vectors.encode.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing tracking point vector ${name}`);
  return { bytes: new Uint8Array(Buffer.from(found.hex, "hex")), decoded: found.decoded };
};

const stream = (id: string, epochId: string, senderDeviceId = "alice-phone") => ({
  epochId,
  epochNumber: 1,
  id,
  revisionPrefix: "rev-1",
  senderDeviceId,
  senderUserId: "alice",
});

const encryptPoint = ({
  epochId,
  epochKey,
  payload,
  pointId,
  receivedAt,
  senderDeviceId = "alice-phone",
  streamId,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  payload: Uint8Array;
  pointId: string;
  receivedAt: number;
  senderDeviceId?: string;
  streamId: string;
}) => {
  const encrypted = encryptGroupPayload({
    epochId,
    epochKey,
    groupId,
    kind: TRACKING_POINT_KIND,
    payload,
    senderDeviceId,
  });
  return {
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    pointId,
    receivedAt: new Date(receivedAt),
    streamId,
  };
};

const epoch = (
  epochId: string,
  epochNumber: number,
  createdAt: number,
): EpochWraps["epochs"][number] => ({
  createdAt: new Date(createdAt),
  deviceWrap: null,
  epochId,
  epochNumber,
  historyWraps: [],
});

const movingPoint = (time: number, latitude: number) =>
  encodeTrackingPoint({
    accuracy: 8,
    battery: { charging: false, level: 60 },
    latitude,
    longitude: -0.12,
    speed: 2,
    stayUntil: null,
    time,
  });

describe("loadTimelineDay", () => {
  test("follows pages, decrypts in chunks and keeps accuracy and the stay's until-time", async () => {
    const epochKey = generateGroupEpochKey();
    const stay = vector("stay");
    const lookback = encryptPoint({
      epochId: "epoch-1",
      epochKey,
      payload: stay.bytes,
      pointId: "1",
      receivedAt: dayStart - 30 * HOUR_MS,
      streamId: "10",
    });
    const late = encryptPoint({
      epochId: "epoch-1",
      epochKey,
      payload: movingPoint(dayStart + 2 * HOUR_MS, 51.6),
      pointId: "3",
      receivedAt: dayStart - HOUR_MS,
      streamId: "10",
    });
    const early = encryptPoint({
      epochId: "epoch-1",
      epochKey,
      payload: movingPoint(dayStart + HOUR_MS, 51.5),
      pointId: "2",
      receivedAt: dayStart + 3 * HOUR_MS,
      streamId: "10",
    });
    const requests: Array<RouterInputs["groupTracking"]["historyRange"]> = [];
    const pages: RangePage[] = [
      {
        cursor: { pointId: "3", receivedAt: late.receivedAt, streamId: "10" },
        hasMore: true,
        lookback: [lookback],
        points: [late],
        streams: [stream("10", "epoch-1")],
      },
      {
        cursor: { pointId: "2", receivedAt: early.receivedAt, streamId: "10" },
        hasMore: false,
        lookback: [],
        points: [early],
        streams: [stream("10", "epoch-1")],
      },
    ];
    const progress: Array<{ decrypted: number; total: number }> = [];
    let yields = 0;

    const result = await loadTimelineDay({
      chunkSize: 2,
      day,
      fetchRange: async (input) => {
        requests.push(input);
        const page = pages[requests.length - 1];
        if (!page) throw new Error("Asked for too many pages");
        return page;
      },
      groupId,
      listEpochs: async () => ({
        epochs: [epoch("epoch-1", 1, dayStart - 40 * HOUR_MS)],
        nextCursor: null,
      }),
      now: dayStart + 30 * HOUR_MS,
      onProgress: (value) => progress.push(value),
      unwrapEpoch: async () => epochKey,
      yieldToUi: async () => {
        yields += 1;
      },
    });

    expect(requests).toEqual([
      {
        cursor: undefined,
        from: new Date(dayStart - 3 * HOUR_MS),
        groupId,
        limit: 2_000,
        to: new Date(dayStart + 30 * HOUR_MS),
      },
      {
        cursor: { pointId: "3", receivedAt: late.receivedAt, streamId: "10" },
        from: new Date(dayStart - 3 * HOUR_MS),
        groupId,
        limit: 2_000,
        to: new Date(dayStart + 30 * HOUR_MS),
      },
    ]);
    expect(progress).toEqual([
      { decrypted: 2, total: 3 },
      { decrypted: 3, total: 3 },
    ]);
    expect(yields).toBe(2);
    expect(result.joinStart).toBe(dayStart - 40 * HOUR_MS);
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.undecryptable).toBe(0);
    expect(result.devices[0]?.points.map(({ pointId }) => pointId)).toEqual(["1", "2", "3"]);
    expect(result.devices[0]?.points[0]).toEqual({
      ...stay.decoded,
      pointId: "1",
      revisionPrefix: "rev-1",
      streamId: "10",
    });
  });

  test("asks for the day from 3 hours before to 24 hours after, capped at now", async () => {
    const requests: Array<RouterInputs["groupTracking"]["historyRange"]> = [];
    await loadTimelineDay({
      day,
      fetchRange: async (input) => {
        requests.push(input);
        return { cursor: null, hasMore: false, lookback: [], points: [], streams: [] };
      },
      groupId,
      listEpochs: async () => ({ epochs: [], nextCursor: null }),
      now: dayStart + 5 * HOUR_MS,
      unwrapEpoch: async () => null,
      yieldToUi: async () => {},
    });

    expect(requests.map(({ from, to }) => [from.getTime(), to.getTime()])).toEqual([
      [dayStart - 3 * HOUR_MS, dayStart + 5 * HOUR_MS],
    ]);
  });

  test("skips and counts points with a missing key or bad ciphertext", async () => {
    const epochKey = generateGroupEpochKey();
    const good = encryptPoint({
      epochId: "epoch-2",
      epochKey,
      payload: movingPoint(dayStart + HOUR_MS, 51.5),
      pointId: "1",
      receivedAt: dayStart + HOUR_MS,
      streamId: "20",
    });
    const tampered = {
      ...encryptPoint({
        epochId: "epoch-2",
        epochKey,
        payload: movingPoint(dayStart + 2 * HOUR_MS, 51.5),
        pointId: "2",
        receivedAt: dayStart + 2 * HOUR_MS,
        streamId: "20",
      }),
      nonce: good.nonce,
    };
    const wrongDevice = encryptPoint({
      epochId: "epoch-2",
      epochKey,
      payload: movingPoint(dayStart + 3 * HOUR_MS, 51.5),
      pointId: "3",
      receivedAt: dayStart + 3 * HOUR_MS,
      senderDeviceId: "someone-else",
      streamId: "20",
    });
    const noKey = encryptPoint({
      epochId: "epoch-1",
      epochKey: generateGroupEpochKey(),
      payload: movingPoint(dayStart + 4 * HOUR_MS, 51.5),
      pointId: "4",
      receivedAt: dayStart + 4 * HOUR_MS,
      streamId: "10",
    });
    const garbage = encryptPoint({
      epochId: "epoch-2",
      epochKey,
      payload: new Uint8Array(23),
      pointId: "5",
      receivedAt: dayStart + 5 * HOUR_MS,
      streamId: "20",
    });

    const result = await loadTimelineDay({
      day,
      fetchRange: async () => ({
        cursor: null,
        hasMore: false,
        lookback: [],
        points: [good, tampered, wrongDevice, noKey, garbage],
        streams: [stream("10", "epoch-1"), stream("20", "epoch-2")],
      }),
      groupId,
      listEpochs: async () => ({
        epochs: [
          epoch("epoch-2", 2, dayStart - HOUR_MS),
          epoch("epoch-1", 1, dayStart - 2 * HOUR_MS),
        ],
        nextCursor: null,
      }),
      now: day.end,
      unwrapEpoch: async (wraps) => (wraps.epochId === "epoch-2" ? epochKey : null),
      yieldToUi: async () => {},
    });

    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.points.map(({ pointId }) => pointId)).toEqual(["1"]);
    expect(result.devices[0]?.undecryptable).toBe(4);
  });

  test("stops reading epochs once it has the keys and an epoch from before the day", async () => {
    const cursors: Array<number | null> = [];
    const result = await loadTimelineDay({
      day,
      fetchRange: async () => ({
        cursor: null,
        hasMore: false,
        lookback: [],
        points: [],
        streams: [stream("10", "epoch-5")],
      }),
      groupId,
      listEpochs: async (cursor) => {
        cursors.push(cursor);
        if (cursor === null) {
          return { epochs: [epoch("epoch-6", 6, dayStart + HOUR_MS)], nextCursor: 6 };
        }
        return { epochs: [epoch("epoch-5", 5, dayStart - HOUR_MS)], nextCursor: 5 };
      },
      now: day.end,
      unwrapEpoch: async () => generateGroupEpochKey(),
      yieldToUi: async () => {},
    });

    expect(cursors).toEqual([null, 6]);
    expect(result.joinStart).toBeNull();
  });

  test("keeps every point of the last batch before the range so a later stay wins", async () => {
    const epochKey = generateGroupEpochKey();
    const batchAt = dayStart - 10 * 60_000;
    const stay = encryptPoint({
      epochId: "epoch-1",
      epochKey,
      payload: encodeTrackingPoint({
        accuracy: 10,
        battery: { charging: false, level: 80 },
        latitude: 51.5,
        longitude: -0.1,
        speed: null,
        stayUntil: dayStart + 8 * HOUR_MS,
        time: dayStart - 15 * 60_000,
      }),
      pointId: "1",
      receivedAt: batchAt,
      streamId: "10",
    });
    const moving = encryptPoint({
      epochId: "epoch-1",
      epochKey,
      payload: movingPoint(dayStart - 20 * 60_000, 51.4),
      pointId: "2",
      receivedAt: batchAt,
      streamId: "10",
    });
    const fetched = [stay, moving];

    const result = await loadTimelineDay({
      day,
      fetchRange: async () => ({
        cursor: { pointId: "2", receivedAt: new Date(batchAt), streamId: "10" },
        hasMore: false,
        lookback: fetched,
        points: [moving],
        streams: [stream("10", "epoch-1")],
      }),
      groupId,
      listEpochs: async () => ({
        epochs: [epoch("epoch-1", 1, dayStart - 40 * HOUR_MS)],
        nextCursor: null,
      }),
      now: dayStart + 9 * HOUR_MS,
      unwrapEpoch: async () => epochKey,
      yieldToUi: async () => {},
    });

    expect(result.devices[0]?.points.map(({ pointId }) => pointId)).toEqual(["2", "1"]);
    const timeline = buildTimeline({
      day,
      devices: result.devices,
      joinStart: result.joinStart,
      now: dayStart + 9 * HOUR_MS,
      windowStart: dayStart - 14 * 24 * HOUR_MS,
    });
    expect(timelinePositionAt(timeline.devices[0]?.segments ?? [], dayStart + 7 * HOUR_MS)).toEqual(
      {
        position: { accuracy: 10, latitude: 51.5, longitude: -0.1 },
        state: "stay",
      },
    );
  });

  test("doesn't report progress or finish once cancelled mid-decrypt", async () => {
    const epochKey = generateGroupEpochKey();
    const controller = new AbortController();
    const points = [1, 2, 3].map((index) =>
      encryptPoint({
        epochId: "epoch-1",
        epochKey,
        payload: movingPoint(dayStart + index * HOUR_MS, 51.5),
        pointId: String(index),
        receivedAt: dayStart + index * HOUR_MS,
        streamId: "10",
      }),
    );
    const progress: Array<{ decrypted: number; total: number }> = [];

    await expect(
      loadTimelineDay({
        chunkSize: 2,
        day,
        fetchRange: async () => ({
          cursor: null,
          hasMore: false,
          lookback: [],
          points,
          streams: [stream("10", "epoch-1")],
        }),
        groupId,
        listEpochs: async () => ({
          epochs: [epoch("epoch-1", 1, dayStart - 40 * HOUR_MS)],
          nextCursor: null,
        }),
        now: day.end,
        onProgress: (value) => progress.push(value),
        signal: controller.signal,
        unwrapEpoch: async () => epochKey,
        yieldToUi: async () => {
          if (progress.length === 2) controller.abort();
        },
      }),
    ).rejects.toThrow("Timeline load cancelled.");
    expect(progress).toEqual([
      { decrypted: 2, total: 3 },
      { decrypted: 3, total: 3 },
    ]);
  });

  test("gives up when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadTimelineDay({
        day,
        fetchRange: async () => {
          throw new Error("Shouldn't fetch");
        },
        groupId,
        listEpochs: async () => ({ epochs: [], nextCursor: null }),
        now: day.end,
        signal: controller.signal,
        unwrapEpoch: async () => null,
        yieldToUi: async () => {},
      }),
    ).rejects.toThrow("Timeline load cancelled.");
  });
});
