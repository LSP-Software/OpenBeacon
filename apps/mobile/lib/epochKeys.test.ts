import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  decodeBase64,
  type EpochKeyMaterial,
  encodeBase64,
  generateGroupEpochKey,
  type HistoryPrivateKeyMaterial,
  wrapEpochKeyForHistoryKey,
  wrapEpochKeyForRecipient,
} from "@openbeacon/encryption";

const deviceKeyPair = createDeviceKeyPair();
const senderKeyPair = createDeviceKeyPair();
const historyV1 = createHistoryKeyPair();
const historyV2 = createHistoryKeyPair();
const device = { deviceId: "device-1", privateKey: deviceKeyPair.privateKey, userId: "user-1" };
let storedHistoryKeys = new Map<string, HistoryPrivateKeyMaterial>();
let epochKeyWraps: unknown = null;
const getEpochKeyWrapsMock = mock(async (_input: unknown) => epochKeyWraps);

mock.module("./api.ts", () => ({
  trpcClient: { groupEpoch: { getEpochKeyWraps: { query: getEpochKeyWrapsMock } } },
}));
mock.module("./deviceKeys.ts", () => ({ ensureDeviceKeyRegistration: async () => device }));
mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async ({ userId, version }: { userId: string; version: number }) =>
    storedHistoryKeys.get(`${userId}:${version}`) ?? null,
  storeHistoryKey: async () => {},
}));

const { createHistoryKeyReader, resolveEpochKey, unwrapEpochKeyFromWraps } =
  await import("./epochKeys.ts");

const deviceWrapFor = ({
  epochId,
  epochKey,
  recipientPublicKey = deviceKeyPair.publicKey,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  recipientPublicKey?: string;
}) =>
  wrapEpochKeyForRecipient({
    epoch: {
      createdAt: new Date(0),
      createdByDeviceId: "sender",
      epochId,
      epochNumber: 1,
      groupId: "group-1",
    },
    epochKey,
    recipient: {
      algorithm: DEVICE_KEY_ALGORITHM,
      createdAt: new Date(0),
      deviceId: device.deviceId,
      publicKey: recipientPublicKey,
      revokedAt: null,
      userId: device.userId,
    },
    senderPrivateKey: senderKeyPair.privateKey,
  });

const historyWrapFor = ({
  epochId,
  epochKey,
  historyPublicKey,
  userId = device.userId,
  version,
}: {
  epochId: string;
  epochKey: EpochKeyMaterial;
  historyPublicKey: string;
  userId?: string;
  version: number;
}) => ({
  ...wrapEpochKeyForHistoryKey({
    epochId,
    epochKey,
    historyKey: { publicKey: historyPublicKey, userId, version },
    senderPrivateKey: senderKeyPair.privateKey,
  }),
  createdAt: new Date(0),
});

const holding = (keys: Record<number, HistoryPrivateKeyMaterial>) => {
  const getHistoryKey = mock(async (version: number) => keys[version] ?? null);
  return getHistoryKey;
};

const resolve = ({
  epochId = "epoch-1",
  getHistoryKey = holding({ 1: historyV1.privateKey, 2: historyV2.privateKey }),
  wraps,
}: {
  epochId?: string;
  getHistoryKey?: (version: number) => Promise<HistoryPrivateKeyMaterial | null>;
  wraps: Parameters<typeof unwrapEpochKeyFromWraps>[0]["wraps"];
}) => unwrapEpochKeyFromWraps({ device, epochId, getHistoryKey, wraps });

const tamper = (value: string) => {
  const bytes = decodeBase64(value);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return encodeBase64(bytes);
};

describe("unwrapEpochKeyFromWraps", () => {
  test("prefers the device wrap when a history wrap also exists", async () => {
    const deviceEpochKey = generateGroupEpochKey();
    const getHistoryKey = holding({ 1: historyV1.privateKey });
    const epochKey = await resolve({
      getHistoryKey,
      wraps: {
        deviceWrap: deviceWrapFor({ epochId: "epoch-1", epochKey: deviceEpochKey }),
        historyWraps: [
          historyWrapFor({
            epochId: "epoch-1",
            epochKey: generateGroupEpochKey(),
            historyPublicKey: historyV1.publicKey,
            version: 1,
          }),
        ],
      },
    });

    expect(epochKey?.expose()).toEqual(deviceEpochKey.expose());
    expect(getHistoryKey).not.toHaveBeenCalled();
  });

  test("uses a history wrap for each version the device holds when there's no device wrap", async () => {
    const epochKey = generateGroupEpochKey();
    const wraps = {
      deviceWrap: null,
      historyWraps: [
        historyWrapFor({
          epochId: "epoch-1",
          epochKey,
          historyPublicKey: historyV1.publicKey,
          version: 1,
        }),
        historyWrapFor({
          epochId: "epoch-1",
          epochKey,
          historyPublicKey: historyV2.publicKey,
          version: 2,
        }),
      ],
    };

    for (const keys of [{ 1: historyV1.privateKey }, { 2: historyV2.privateKey }]) {
      expect((await resolve({ getHistoryKey: holding(keys), wraps }))?.expose()).toEqual(
        epochKey.expose(),
      );
    }
  });

  test("ignores a history wrap for a version the device doesn't hold", async () => {
    const getHistoryKey = holding({ 1: historyV1.privateKey });
    const epochKey = await resolve({
      getHistoryKey,
      wraps: {
        deviceWrap: null,
        historyWraps: [
          historyWrapFor({
            epochId: "epoch-1",
            epochKey: generateGroupEpochKey(),
            historyPublicKey: historyV2.publicKey,
            version: 2,
          }),
        ],
      },
    });

    expect(epochKey).toBeNull();
    expect(getHistoryKey.mock.calls).toEqual([[2]]);
  });

  test("falls through a tampered device wrap to a valid history wrap", async () => {
    const epochKey = generateGroupEpochKey();
    const deviceWrap = deviceWrapFor({ epochId: "epoch-1", epochKey: generateGroupEpochKey() });

    const resolved = await resolve({
      wraps: {
        deviceWrap: { ...deviceWrap, wrappedKey: tamper(deviceWrap.wrappedKey) },
        historyWraps: [
          historyWrapFor({
            epochId: "epoch-1",
            epochKey,
            historyPublicKey: historyV1.publicKey,
            version: 1,
          }),
        ],
      },
    });

    expect(resolved?.expose()).toEqual(epochKey.expose());
  });

  test("falls through a tampered history wrap to another held version", async () => {
    const epochKey = generateGroupEpochKey();
    const v1Wrap = historyWrapFor({
      epochId: "epoch-1",
      epochKey,
      historyPublicKey: historyV1.publicKey,
      version: 1,
    });

    const resolved = await resolve({
      wraps: {
        deviceWrap: null,
        historyWraps: [
          { ...v1Wrap, wrappedKey: tamper(v1Wrap.wrappedKey) },
          historyWrapFor({
            epochId: "epoch-1",
            epochKey,
            historyPublicKey: historyV2.publicKey,
            version: 2,
          }),
        ],
      },
    });

    expect(resolved?.expose()).toEqual(epochKey.expose());
  });

  test("rejects tampered and mismatched wraps instead of producing a key", async () => {
    const epochKey = generateGroupEpochKey();
    const historyWrap = historyWrapFor({
      epochId: "epoch-1",
      epochKey,
      historyPublicKey: historyV1.publicKey,
      version: 1,
    });
    const otherEpochDeviceWrap = deviceWrapFor({ epochId: "epoch-2", epochKey });
    const rejected = [
      {
        deviceWrap: null,
        historyWraps: [{ ...historyWrap, wrappedKey: tamper(historyWrap.wrappedKey) }],
      },
      {
        deviceWrap: null,
        historyWraps: [{ ...historyWrap, senderPublicKey: deviceKeyPair.publicKey }],
      },
      { deviceWrap: null, historyWraps: [{ ...historyWrap, historyKeyVersion: 2 }] },
      { deviceWrap: null, historyWraps: [{ ...historyWrap, algorithm: "other" }] },
      {
        deviceWrap: null,
        historyWraps: [
          historyWrapFor({
            epochId: "epoch-1",
            epochKey,
            historyPublicKey: historyV1.publicKey,
            userId: "user-2",
            version: 1,
          }),
        ],
      },
      {
        deviceWrap: null,
        historyWraps: [
          historyWrapFor({
            epochId: "epoch-2",
            epochKey,
            historyPublicKey: historyV1.publicKey,
            version: 1,
          }),
        ],
      },
      { deviceWrap: otherEpochDeviceWrap, historyWraps: [] },
      { deviceWrap: { ...otherEpochDeviceWrap, epochId: "epoch-1" }, historyWraps: [] },
      {
        deviceWrap: { ...deviceWrapFor({ epochId: "epoch-1", epochKey }), algorithm: "other" },
        historyWraps: [],
      },
      {
        deviceWrap: deviceWrapFor({
          epochId: "epoch-1",
          epochKey,
          recipientPublicKey: createDeviceKeyPair().publicKey,
        }),
        historyWraps: [],
      },
      {
        deviceWrap: {
          ...deviceWrapFor({ epochId: "epoch-1", epochKey }),
          recipientDeviceId: "device-2",
        },
        historyWraps: [],
      },
    ];

    for (const wraps of rejected) {
      expect(await resolve({ wraps })).toBeNull();
    }
  });
});

describe("resolveEpochKey", () => {
  beforeEach(() => {
    storedHistoryKeys = new Map();
    getEpochKeyWrapsMock.mockClear();
  });

  test("fetches this device's wraps and unwraps with the signed-in user's stored history key", async () => {
    const epochKey = generateGroupEpochKey();
    storedHistoryKeys.set("user-1:1", historyV1.privateKey);
    epochKeyWraps = {
      deviceWrap: null,
      historyWraps: [
        historyWrapFor({
          epochId: "epoch-1",
          epochKey,
          historyPublicKey: historyV1.publicKey,
          version: 1,
        }),
      ],
    };

    const resolved = await resolveEpochKey({ epochId: "epoch-1", groupId: "group-1" });

    expect(resolved?.expose()).toEqual(epochKey.expose());
    expect(getEpochKeyWrapsMock.mock.calls).toEqual([
      [{ deviceId: "device-1", epochId: "epoch-1", groupId: "group-1" }],
    ]);
  });

  test("doesn't use another user's history key stored on the same device", async () => {
    storedHistoryKeys.set("user-2:1", historyV1.privateKey);
    epochKeyWraps = {
      deviceWrap: null,
      historyWraps: [
        historyWrapFor({
          epochId: "epoch-1",
          epochKey: generateGroupEpochKey(),
          historyPublicKey: historyV1.publicKey,
          version: 1,
        }),
      ],
    };

    expect(await resolveEpochKey({ epochId: "epoch-1", groupId: "group-1" })).toBeNull();
  });

  test("history key reader loads each version once", async () => {
    storedHistoryKeys.set("user-1:1", historyV1.privateKey);
    const read = createHistoryKeyReader("user-1");

    expect(await read(1)).toBe(historyV1.privateKey);
    storedHistoryKeys.clear();
    expect(await read(1)).toBe(historyV1.privateKey);
    expect(await read(2)).toBeNull();
  });
});
