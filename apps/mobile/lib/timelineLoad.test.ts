import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  encodeTrackingPoint,
  encryptGroupPayload,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  TRACKING_POINT_KIND,
  type TrackingPoint,
  unwrapHistoryEpochKey,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import type { RouterInputs, RouterOutputs } from "./api.ts";
import { buildTimeline, timelinePositionAt } from "./timeline.ts";
import { loadTimelineDay } from "./timelineLoad.ts";
import type { TimelineDecryptProgress } from "./timelineTypes.ts";

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
  recordedAt,
  senderDeviceId = "alice-phone",
  streamId,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  payload: Uint8Array;
  pointId: string;
  recordedAt: number;
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
    capturedHour: Math.floor(recordedAt / HOUR_MS),
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    pointId,
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
      recordedAt: stay.decoded.time,
      streamId: "10",
    });
    const late = encryptPoint({
      epochId: "epoch-1",
      epochKey,
      payload: movingPoint(dayStart + 2 * HOUR_MS, 51.6),
      pointId: "3",
      recordedAt: dayStart + 2 * HOUR_MS,
      streamId: "10",
    });
    const early = encryptPoint({
      epochId: "epoch-1",
      epochKey,
      payload: movingPoint(dayStart + HOUR_MS, 51.5),
      pointId: "2",
      recordedAt: dayStart + HOUR_MS,
      streamId: "10",
    });
    const requests: Array<RouterInputs["groupTracking"]["historyRange"]> = [];
    const pages: RangePage[] = [
      {
        cursor: { capturedHour: early.capturedHour, pointId: "2", streamId: "10" },
        hasMore: true,
        lookback: [lookback],
        points: [early],
        streams: [stream("10", "epoch-1")],
      },
      {
        cursor: { capturedHour: late.capturedHour, pointId: "3", streamId: "10" },
        hasMore: false,
        lookback: [],
        points: [late],
        streams: [stream("10", "epoch-1")],
      },
    ];
    const progress: TimelineDecryptProgress[][] = [];
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
      onProgress: (value) => progress.push(value),
      unwrapEpoch: async () => epochKey,
      userIds: ["alice"],
      yieldToUi: async () => {
        yields += 1;
      },
    });

    const fromHour = dayStart / HOUR_MS;
    expect(requests).toEqual([
      { cursor: undefined, fromHour, groupId, limit: 2_000, toHour: fromHour + 24 },
      {
        cursor: { capturedHour: early.capturedHour, pointId: "2", streamId: "10" },
        fromHour,
        groupId,
        limit: 2_000,
        toHour: fromHour + 24,
      },
    ]);
    expect(progress).toEqual([
      [{ decrypted: 0, done: false, total: 3, userId: "alice" }],
      [{ decrypted: 2, done: false, total: 3, userId: "alice" }],
      [{ decrypted: 3, done: true, total: 3, userId: "alice" }],
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

  test("asks only for the day's own UTC hours, even for today", async () => {
    const requests: Array<RouterInputs["groupTracking"]["historyRange"]> = [];
    await loadTimelineDay({
      day,
      fetchRange: async (input) => {
        requests.push(input);
        return { cursor: null, hasMore: false, lookback: [], points: [], streams: [] };
      },
      groupId,
      listEpochs: async () => ({ epochs: [], nextCursor: null }),
      unwrapEpoch: async () => null,
      userIds: ["alice"],
      yieldToUi: async () => {},
    });

    expect(requests.map(({ fromHour, toHour }) => [fromHour, toHour])).toEqual([
      [dayStart / HOUR_MS, dayStart / HOUR_MS + 24],
    ]);
  });

  test("a point filed under a different hour than its encrypted time counts as undecryptable", async () => {
    const epochKey = generateGroupEpochKey();
    const recorded = (
      pointId: string,
      time: number,
      capturedHour = Math.floor(time / HOUR_MS),
    ) => ({
      ...encryptPoint({
        epochId: "epoch-1",
        epochKey,
        payload: movingPoint(time, 51.5),
        pointId,
        recordedAt: time,
        streamId: "10",
      }),
      capturedHour,
    });
    const hour = dayStart / HOUR_MS;

    const result = await loadTimelineDay({
      day,
      fetchRange: async () => ({
        cursor: null,
        hasMore: false,
        lookback: [recorded("moved-from-yesterday", dayStart - HOUR_MS, hour - 2)],
        points: [
          recorded("on-the-hour", dayStart + 2 * HOUR_MS),
          recorded("last-moment", dayStart + 3 * HOUR_MS - 1),
          recorded("moved-later", dayStart + 4 * HOUR_MS - 1, hour + 4),
          recorded("moved-earlier", dayStart + 5 * HOUR_MS, hour + 4),
          recorded("moved-to-another-day", dayStart - 20 * HOUR_MS, hour + 6),
        ],
        streams: [stream("10", "epoch-1")],
      }),
      groupId,
      listEpochs: async () => ({
        epochs: [epoch("epoch-1", 1, dayStart - 40 * HOUR_MS)],
        nextCursor: null,
      }),
      unwrapEpoch: async () => epochKey,
      userIds: ["alice"],
      yieldToUi: async () => {},
    });

    expect(result.devices[0]?.points.map(({ pointId }) => pointId)).toEqual([
      "on-the-hour",
      "last-moment",
    ]);
    expect(result.devices[0]?.undecryptable).toBe(4);
  });

  test("skips and counts points with a missing key or bad ciphertext", async () => {
    const epochKey = generateGroupEpochKey();
    const good = encryptPoint({
      epochId: "epoch-2",
      epochKey,
      payload: movingPoint(dayStart + HOUR_MS, 51.5),
      pointId: "1",
      recordedAt: dayStart + HOUR_MS,
      streamId: "20",
    });
    const tampered = {
      ...encryptPoint({
        epochId: "epoch-2",
        epochKey,
        payload: movingPoint(dayStart + 2 * HOUR_MS, 51.5),
        pointId: "2",
        recordedAt: dayStart + 2 * HOUR_MS,
        streamId: "20",
      }),
      nonce: good.nonce,
    };
    const wrongDevice = encryptPoint({
      epochId: "epoch-2",
      epochKey,
      payload: movingPoint(dayStart + 3 * HOUR_MS, 51.5),
      pointId: "3",
      recordedAt: dayStart + 3 * HOUR_MS,
      senderDeviceId: "someone-else",
      streamId: "20",
    });
    const noKey = encryptPoint({
      epochId: "epoch-1",
      epochKey: generateGroupEpochKey(),
      payload: movingPoint(dayStart + 4 * HOUR_MS, 51.5),
      pointId: "4",
      recordedAt: dayStart + 4 * HOUR_MS,
      streamId: "10",
    });
    const garbage = encryptPoint({
      epochId: "epoch-2",
      epochKey,
      payload: new Uint8Array(23),
      pointId: "5",
      recordedAt: dayStart + 5 * HOUR_MS,
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
      unwrapEpoch: async (wraps) => (wraps.epochId === "epoch-2" ? epochKey : null),
      userIds: ["alice"],
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
      unwrapEpoch: async () => generateGroupEpochKey(),
      userIds: ["alice"],
      yieldToUi: async () => {},
    });

    expect(cursors).toEqual([null, 6]);
    expect(result.joinStart).toBeNull();
  });

  test("keeps every point of the last hour before the range so a later stay wins", async () => {
    const epochKey = generateGroupEpochKey();
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
      recordedAt: dayStart - 15 * 60_000,
      streamId: "10",
    });
    const moving = encryptPoint({
      epochId: "epoch-1",
      epochKey,
      payload: movingPoint(dayStart - 20 * 60_000, 51.4),
      pointId: "2",
      recordedAt: dayStart - 20 * 60_000,
      streamId: "10",
    });
    const fetched = [stay, moving];

    const result = await loadTimelineDay({
      day,
      fetchRange: async () => ({
        cursor: { capturedHour: moving.capturedHour, pointId: "2", streamId: "10" },
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
      unwrapEpoch: async () => epochKey,
      userIds: ["alice"],
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
        position: { accuracy: 10, latitude: 51.5, longitude: -0.1, speed: null },
        state: "stay",
      },
    );
  });

  test("decrypts one person at a time in the order asked and leaves out everyone else", async () => {
    const epochKey = generateGroupEpochKey();
    const people = [
      { epochId: "epoch-1", points: 3, userId: "alice" },
      { epochId: "epoch-2", points: 1, userId: "bob" },
      { epochId: "epoch-1", points: 2, userId: "carol" },
    ];
    const points = people.flatMap(({ epochId, points: count, userId }) =>
      Array.from({ length: count }, (_, index) =>
        encryptPoint({
          epochId,
          epochKey,
          payload: movingPoint(dayStart + (index + 1) * HOUR_MS, 51.5),
          pointId: `${userId}-${index}`,
          recordedAt: dayStart + (index + 1) * HOUR_MS,
          senderDeviceId: `${userId}-phone`,
          streamId: userId,
        }),
      ),
    );
    const events: string[] = [];
    const unwrapped: string[] = [];

    const result = await loadTimelineDay({
      chunkSize: 2,
      day,
      fetchRange: async () => ({
        cursor: null,
        hasMore: false,
        lookback: [],
        points,
        streams: people.map(({ epochId, userId }) => ({
          ...stream(userId, epochId, `${userId}-phone`),
          senderUserId: userId,
        })),
      }),
      groupId,
      listEpochs: async () => ({
        epochs: [
          epoch("epoch-2", 2, dayStart - 20 * HOUR_MS),
          epoch("epoch-1", 1, dayStart - 40 * HOUR_MS),
        ],
        nextCursor: null,
      }),
      onPersonReady: ({ devices, joinStart, userId }) =>
        events.push(
          `ready ${userId}: ${devices.map((device) => `${device.deviceId} ${device.points.length}`).join(", ")} from ${joinStart}`,
        ),
      onProgress: (progress) =>
        events.push(
          progress
            .map(
              ({ decrypted, done, total, userId }) =>
                `${userId} ${decrypted}/${total}${done ? " done" : ""}`,
            )
            .join(", "),
        ),
      unwrapEpoch: async (wraps) => {
        unwrapped.push(wraps.epochId);
        return epochKey;
      },
      userIds: ["carol", "alice", "dave"],
      yieldToUi: async () => {},
    });

    const joinedAt = dayStart - 40 * HOUR_MS;
    expect(events).toEqual([
      "carol 0/2, alice 0/3",
      "carol 2/2 done, alice 0/3",
      `ready carol: carol-phone 2 from ${joinedAt}`,
      "carol 2/2 done, alice 2/3",
      "carol 2/2 done, alice 3/3 done",
      `ready alice: alice-phone 3 from ${joinedAt}`,
    ]);
    expect(unwrapped).toEqual(["epoch-1"]);
    expect(result.devices.map(({ deviceId }) => deviceId)).toEqual(["carol-phone", "alice-phone"]);
    expect(result.joinStart).toBe(joinedAt);
  });

  test("uses a history wrap for an epoch this phone has no device wrap for", async () => {
    const userId = "me";
    const historyKey = createHistoryKeyPair();
    const sender = createDeviceKeyPair();
    const joinEpochKey = generateGroupEpochKey();
    const laterEpochKey = generateGroupEpochKey();
    const joinedAt = dayStart - 30 * HOUR_MS;
    const joinEpoch = {
      ...epoch("epoch-1", 1, joinedAt),
      historyWraps: [
        {
          ...wrapEpochKeyForHistoryKey({
            epochId: "epoch-1",
            epochKey: joinEpochKey,
            historyKey: { publicKey: historyKey.publicKey, userId, version: 1 },
            senderPrivateKey: sender.privateKey,
          }),
          createdAt: new Date(joinedAt),
        },
      ],
    };
    const deviceKeys = new Map([["epoch-2", laterEpochKey]]);
    const pointIn = (epochId: string, epochKey: EpochKeyMaterial, hour: number) =>
      encryptPoint({
        epochId,
        epochKey,
        payload: movingPoint(dayStart + hour * HOUR_MS, 51.5),
        pointId: epochId,
        recordedAt: dayStart + hour * HOUR_MS,
        streamId: epochId,
      });

    const result = await loadTimelineDay({
      day,
      fetchRange: async () => ({
        cursor: null,
        hasMore: false,
        lookback: [],
        points: [pointIn("epoch-1", joinEpochKey, 1), pointIn("epoch-2", laterEpochKey, 2)],
        streams: [stream("epoch-1", "epoch-1"), stream("epoch-2", "epoch-2")],
      }),
      groupId,
      listEpochs: async () => ({
        epochs: [epoch("epoch-2", 2, dayStart - 10 * HOUR_MS), joinEpoch],
        nextCursor: null,
      }),
      unwrapEpoch: async (wraps) => {
        const fromDevice = deviceKeys.get(wraps.epochId);
        if (fromDevice) return fromDevice;
        const wrap = wraps.historyWraps[0];
        if (wrap?.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) return null;
        return unwrapHistoryEpochKey({
          epochId: wraps.epochId,
          historyKeyVersion: wrap.historyKeyVersion,
          historyPrivateKey: historyKey.privateKey,
          userId,
          wrappedEpochKey: { ...wrap, algorithm: WRAPPED_EPOCH_KEY_ALGORITHM },
        });
      },
      userIds: ["alice"],
      yieldToUi: async () => {},
    });

    expect(result.devices[0]?.points.map(({ pointId }) => pointId)).toEqual(["epoch-1", "epoch-2"]);
    expect(result.devices[0]?.undecryptable).toBe(0);
    expect(result.joinStart).toBe(joinedAt);
  });

  test("stops before the next person once cancelled", async () => {
    const epochKey = generateGroupEpochKey();
    const controller = new AbortController();
    const points = ["alice", "bob"].map((userId, index) =>
      encryptPoint({
        epochId: "epoch-1",
        epochKey,
        payload: movingPoint(dayStart + index * HOUR_MS, 51.5),
        pointId: String(index),
        recordedAt: dayStart + index * HOUR_MS,
        senderDeviceId: `${userId}-phone`,
        streamId: userId,
      }),
    );
    const events: string[] = [];

    await expect(
      loadTimelineDay({
        day,
        fetchRange: async () => ({
          cursor: null,
          hasMore: false,
          lookback: [],
          points,
          streams: [
            stream("alice", "epoch-1", "alice-phone"),
            { ...stream("bob", "epoch-1", "bob-phone"), senderUserId: "bob" },
          ],
        }),
        groupId,
        listEpochs: async () => ({
          epochs: [epoch("epoch-1", 1, dayStart - 40 * HOUR_MS)],
          nextCursor: null,
        }),
        onPersonReady: ({ userId }) => {
          events.push(`ready ${userId}`);
          controller.abort();
        },
        onProgress: (people) =>
          events.push(people.map((person) => `${person.userId} ${person.decrypted}`).join(", ")),
        signal: controller.signal,
        unwrapEpoch: async () => epochKey,
        userIds: ["alice", "bob"],
        yieldToUi: async () => {},
      }),
    ).rejects.toThrow("Timeline load cancelled.");
    expect(events).toEqual(["alice 0, bob 0", "alice 1, bob 0", "ready alice"]);
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
        signal: controller.signal,
        unwrapEpoch: async () => null,
        userIds: ["alice"],
        yieldToUi: async () => {},
      }),
    ).rejects.toThrow("Timeline load cancelled.");
  });
});
