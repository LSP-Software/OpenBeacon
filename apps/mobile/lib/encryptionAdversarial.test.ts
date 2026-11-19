import { describe, expect, test } from "bun:test";
import {
  decodeBase64,
  encodeBase64,
  encodePlaceGeometryV1,
  encodeTrackingPoint,
  encryptGroupPayload,
  type EpochKeyMaterial,
  generateGroupEpochKey,
  PLACE_GEOMETRY_KIND,
  TRACKING_POINT_KIND,
} from "@openbeacon/encryption";
import type { RouterOutputs } from "./api.ts";
import { createMapTrackingDecryptPoint } from "./mapTrackingDecrypt.ts";
import type { MapTrackingEncryptedPoint } from "./mapTrackingTypes.ts";
import { loadTimelineDay } from "./timelineLoad.ts";

type RangePage = RouterOutputs["groupTracking"]["historyRange"];

const HOUR_MS = 60 * 60_000;
const dayStart = Date.parse("2026-11-18T00:00:00Z");
const day = { end: dayStart + 24 * HOUR_MS, key: "2026-11-18", start: dayStart };
const pointTime = dayStart + 9 * HOUR_MS;
const epochKey = generateGroupEpochKey();

const location = (time = pointTime) =>
  encodeTrackingPoint({
    accuracy: 10,
    battery: { charging: false, level: 42 },
    latitude: 51.5,
    longitude: -0.12,
    speed: 1,
    stayUntil: null,
    time,
  });

const seal = ({
  groupId = "group-1",
  kind = TRACKING_POINT_KIND,
  key = epochKey,
  payload = location(),
  senderDeviceId = "alice-phone",
}: {
  groupId?: string;
  kind?: string;
  key?: EpochKeyMaterial;
  payload?: Uint8Array;
  senderDeviceId?: string;
} = {}) =>
  encryptGroupPayload({
    epochId: "epoch-1",
    epochKey: key,
    groupId,
    kind,
    payload,
    senderDeviceId,
  });

const everyBitFlip = (value: string) => {
  const bytes = decodeBase64(value);
  return Array.from({ length: bytes.length * 8 }, (_, position) => {
    const copy = Uint8Array.from(bytes);
    const index = Math.floor(position / 8);
    copy[index] = (copy[index] ?? 0) ^ (1 << (position % 8));
    return encodeBase64(copy);
  });
};

describe("live map decryption under attack", () => {
  const sealed = seal();
  const mapPoint: MapTrackingEncryptedPoint = {
    ciphertext: sealed.ciphertext,
    epochId: "epoch-1",
    nonce: sealed.nonce,
    revisionPrefix: "rev-1",
    senderDeviceId: "alice-phone",
    senderUserId: "alice",
    updatedAt: new Date(pointTime),
  };
  const decryptPoint = createMapTrackingDecryptPoint({ resolveEpochKey: async () => epochKey });
  const statuses = async (points: MapTrackingEncryptedPoint[], groupId = "group-1") =>
    new Set(
      await Promise.all(
        points.map(async (point) => (await decryptPoint({ groupId, point })).status),
      ),
    );

  test("shows the untouched point", async () => {
    const result = await decryptPoint({ groupId: "group-1", point: mapPoint });

    expect(result.status).toBe("ok");
    expect(result.status === "ok" ? result.entry.battery.level : null).toBe(42);
  });

  test("never shows a point with any single bit of its ciphertext, tag or nonce changed", async () => {
    expect(
      await statuses([
        ...everyBitFlip(mapPoint.ciphertext).map((ciphertext) => ({ ...mapPoint, ciphertext })),
        ...everyBitFlip(mapPoint.nonce).map((nonce) => ({ ...mapPoint, nonce })),
      ]),
    ).toEqual(new Set(["undecryptable"]));
  });

  test("never shows a point moved to another sender, epoch or group", async () => {
    expect(
      await statuses([
        { ...mapPoint, senderDeviceId: "bob-phone" },
        { ...mapPoint, epochId: "epoch-2" },
      ]),
    ).toEqual(new Set(["undecryptable"]));
    expect(await statuses([mapPoint], "group-2")).toEqual(new Set(["undecryptable"]));
  });

  test("a member holding the epoch key can't make the map show junk or a place as a location", async () => {
    const junk = [
      seal({ payload: new Uint8Array() }),
      seal({ payload: new Uint8Array(22) }),
      seal({ payload: new Uint8Array(24) }),
      seal({ payload: Uint8Array.from(location(), (byte, index) => (index === 0 ? 1 : byte)) }),
      seal({ payload: new Uint8Array(23).fill(0xff) }),
      seal({
        kind: PLACE_GEOMETRY_KIND,
        payload: encodePlaceGeometryV1({ latitude: 1, longitude: 1, radiusMeters: 100, v: 1 }),
      }),
    ];

    expect(
      await statuses(
        junk.map((payload) => ({
          ...mapPoint,
          ciphertext: payload.ciphertext,
          nonce: payload.nonce,
        })),
      ),
    ).toEqual(new Set(["undecryptable"]));
  });

  test.skip("FINDING: the server can attribute Alice's location to Bob, because senderUserId isn't bound to the ciphertext or checked against the device", async () => {
    const result = await decryptPoint({
      groupId: "group-1",
      point: { ...mapPoint, senderUserId: "bob" },
    });

    expect(result.status === "ok" ? result.entry.userId : "alice").toBe("alice");
  });
});

describe("Timeline decryption under attack", () => {
  const stream = (id: string, senderDeviceId: string, senderUserId: string) => ({
    epochId: "epoch-1",
    epochNumber: 1,
    id,
    revisionPrefix: "rev-1",
    senderDeviceId,
    senderUserId,
  });
  const historyPoint = (
    sealed: ReturnType<typeof seal>,
    pointId: string,
    streamId = "s-alice",
  ): RangePage["points"][number] => ({
    capturedHour: Math.floor(pointTime / HOUR_MS),
    ciphertext: sealed.ciphertext,
    nonce: sealed.nonce,
    pointId,
    streamId,
  });
  const load = async (
    points: RangePage["points"],
    streams: RangePage["streams"] = [
      stream("s-alice", "alice-phone", "alice"),
      stream("s-bob", "bob-phone", "bob"),
    ],
    userIds = ["alice", "bob"],
  ) =>
    loadTimelineDay({
      day,
      fetchRange: async () => ({ cursor: null, hasMore: false, lookback: [], points, streams }),
      groupId: "group-1",
      listEpochs: async () => ({
        epochs: [
          {
            createdAt: new Date(dayStart - HOUR_MS),
            deviceWrap: null,
            epochId: "epoch-1",
            epochNumber: 1,
            historyWraps: [],
          },
        ],
        nextCursor: null,
      }),
      unwrapEpoch: async () => epochKey,
      userIds,
      yieldToUi: async () => {},
    });
  const totals = (result: Awaited<ReturnType<typeof load>>) =>
    Object.fromEntries(
      result.devices.map((device) => [
        device.deviceId,
        { points: device.points.length, undecryptable: device.undecryptable },
      ]),
    );

  test("counts every tampered point as undecryptable and never draws one", async () => {
    const sealed = seal();
    const tampered = [
      ...everyBitFlip(sealed.ciphertext).map((ciphertext) => ({ ...sealed, ciphertext })),
      ...everyBitFlip(sealed.nonce).map((nonce) => ({ ...sealed, nonce })),
    ];

    const result = await load([
      historyPoint(sealed, "good"),
      ...tampered.map((changed, index) => historyPoint(changed, `bad-${index}`)),
    ]);

    expect(totals(result)).toEqual({
      "alice-phone": { points: 1, undecryptable: tampered.length },
    });
  });

  test("a point moved into another member's stream isn't drawn for them", async () => {
    const result = await load([historyPoint(seal(), "moved", "s-bob")]);

    expect(totals(result)).toEqual({ "bob-phone": { points: 0, undecryptable: 1 } });
  });

  test("a point copied from another group under the same key isn't drawn", async () => {
    const result = await load([historyPoint(seal({ groupId: "group-2" }), "copied")]);

    expect(totals(result)).toEqual({ "alice-phone": { points: 0, undecryptable: 1 } });
  });

  test("a point sealed under another epoch's key isn't drawn", async () => {
    const result = await load([historyPoint(seal({ key: generateGroupEpochKey() }), "other")]);

    expect(totals(result)).toEqual({ "alice-phone": { points: 0, undecryptable: 1 } });
  });

  test.skip("FINDING: the server can file Alice's history under Bob, because a stream's senderUserId isn't bound to the ciphertext", async () => {
    const result = await load(
      [historyPoint(seal(), "relabelled", "s-relabelled")],
      [stream("s-relabelled", "alice-phone", "bob")],
      ["bob"],
    );

    expect(result.devices.flatMap((device) => device.points)).toHaveLength(0);
  });
});
