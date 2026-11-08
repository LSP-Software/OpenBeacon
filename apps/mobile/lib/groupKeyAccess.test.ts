import { describe, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  generateGroupEpochKey,
  wrapEpochKeyForHistoryKey,
  wrapEpochKeyForRecipient,
} from "@openbeacon/encryption";

mock.module("./api.ts", () => ({ trpcClient: {} }));
mock.module("./deviceKeys.ts", () => ({ ensureDeviceKeyRegistration: async () => ({}) }));
mock.module("./historyKeys.ts", () => ({
  getStoredHistoryKey: async () => null,
  storeHistoryKey: async () => {},
}));

const { unwrapEpochKeyFromWraps } = await import("./epochKeys.ts");
const { checkGroupKeyAccess, checkHistoryRecovery } = await import("./groupKeyAccess.ts");

const deviceKeyPair = createDeviceKeyPair();
const historyKeyPair = createHistoryKeyPair();
const device = { deviceId: "device-1", privateKey: deviceKeyPair.privateKey, userId: "user-1" };

const createEpoch = (epochNumber: number, access: "device" | "history" | "none") => {
  const epochId = `epoch-${epochNumber}`;
  const epochKey = generateGroupEpochKey();
  return {
    createdAt: new Date(Date.UTC(2026, 9, epochNumber)),
    deviceWrap:
      access === "device"
        ? wrapEpochKeyForRecipient({
            epoch: {
              createdAt: new Date(0),
              createdByDeviceId: "device-1",
              epochId,
              epochNumber,
              groupId: "group-1",
            },
            epochKey,
            recipient: {
              algorithm: DEVICE_KEY_ALGORITHM,
              createdAt: new Date(0),
              deviceId: device.deviceId,
              publicKey: deviceKeyPair.publicKey,
              revokedAt: null,
              userId: device.userId,
            },
            senderPrivateKey: deviceKeyPair.privateKey,
          })
        : null,
    epochId,
    epochNumber,
    historyWraps:
      access === "history"
        ? [
            {
              ...wrapEpochKeyForHistoryKey({
                epochId,
                epochKey,
                historyKey: {
                  publicKey: historyKeyPair.publicKey,
                  userId: device.userId,
                  version: 1,
                },
                senderPrivateKey: deviceKeyPair.privateKey,
              }),
              createdAt: new Date(0),
            },
          ]
        : [],
  };
};

const check = async (
  accessByEpoch: Array<"device" | "history" | "none">,
  pageSize = accessByEpoch.length,
) => {
  const newestFirst = accessByEpoch
    .map((access, index) => createEpoch(index + 1, access))
    .reverse();
  const listEpochs = mock(async (cursor: number | null) => {
    const remaining = newestFirst.filter(
      ({ epochNumber }) => cursor === null || epochNumber < cursor,
    );
    const page = remaining.slice(0, pageSize);
    return {
      epochs: page,
      nextCursor: remaining.length > pageSize ? (page.at(-1)?.epochNumber ?? null) : null,
    };
  });
  const result = await checkGroupKeyAccess({
    canResolve: async (epoch) =>
      (await unwrapEpochKeyFromWraps({
        device,
        epochId: epoch.epochId,
        getHistoryKey: async (version) => (version === 1 ? historyKeyPair.privateKey : null),
        wraps: epoch,
      })) !== null,
    listEpochs,
  });
  return { listEpochs, result };
};

const createdAt = (epochNumber: number) => new Date(Date.UTC(2026, 9, epochNumber));

describe("group key access", () => {
  test("reports nothing to read when the group has no epochs", async () => {
    expect((await check([])).result).toEqual({ current: "unavailable", history: "complete" });
  });

  test("reports complete history when every epoch resolves through either wrap", async () => {
    expect((await check(["device", "history", "device"])).result).toEqual({
      current: "available",
      history: "complete",
    });
  });

  test("reports current available with partial history", async () => {
    expect((await check(["device", "none", "history", "device"])).result).toEqual({
      current: "available",
      history: { partialFrom: createdAt(3) },
    });
  });

  test("reports current missing with complete history", async () => {
    expect((await check(["device", "history", "none"])).result).toEqual({
      current: "missing",
      history: "complete",
    });
  });

  test("starts history at the current epoch when the epoch before it can't be read", async () => {
    expect((await check(["device", "none", "none"])).result).toEqual({
      current: "missing",
      history: { partialFrom: createdAt(3) },
    });
  });

  test("only counts the readable run after the newest gap", async () => {
    expect((await check(["device", "device", "none", "device", "device"])).result).toEqual({
      current: "available",
      history: { partialFrom: createdAt(4) },
    });
  });

  test("a new readable epoch never turns partial history into complete", async () => {
    const before = await check(["none", "device"]);
    const after = await check(["none", "device", "device"]);

    expect(before.result.history).toEqual({ partialFrom: createdAt(2) });
    expect(after.result).toEqual({ current: "available", history: { partialFrom: createdAt(2) } });
  });

  test("a rotation that restores current access leaves the lost epoch as a history gap", async () => {
    expect((await check(["device", "none"])).result).toEqual({
      current: "missing",
      history: "complete",
    });
    expect((await check(["device", "none", "device"])).result).toEqual({
      current: "available",
      history: { partialFrom: createdAt(3) },
    });
  });

  test("pages through every epoch and stops at the first gap", async () => {
    const complete = await check(["device", "device", "device", "device", "device"], 2);
    expect(complete.result.history).toBe("complete");
    expect(complete.listEpochs.mock.calls).toEqual([[null], [4], [2]]);

    const partial = await check(["device", "none", "device", "device", "device"], 2);
    expect(partial.result.history).toEqual({ partialFrom: createdAt(3) });
    expect(partial.listEpochs.mock.calls).toEqual([[null], [4]]);
  });

  test("passes on errors instead of reporting missing access", async () => {
    await expect(
      checkGroupKeyAccess({
        canResolve: async () => true,
        listEpochs: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
  });
});

describe("history recovery", () => {
  const recover = async (versionsByEpoch: number[][], pageSize = versionsByEpoch.length) => {
    const newestFirst = versionsByEpoch
      .map((versions, index) => ({
        createdAt: createdAt(index + 1),
        epochNumber: index + 1,
        historyWraps: versions.map((historyKeyVersion) => ({ historyKeyVersion })),
      }))
      .reverse();
    const listEpochs = mock(async (cursor: number | null) => {
      const remaining = newestFirst.filter(
        ({ epochNumber }) => cursor === null || epochNumber < cursor,
      );
      const page = remaining.slice(0, pageSize);
      return {
        epochs: page,
        nextCursor: remaining.length > pageSize ? (page.at(-1)?.epochNumber ?? null) : null,
      };
    });
    const result = await checkHistoryRecovery({ historyKeyVersion: 2, listEpochs });
    return { listEpochs, result };
  };

  test("treats a group with no epochs as fully protected", async () => {
    expect((await recover([])).result).toEqual({ status: "complete" });
  });

  test("reports complete when every epoch has a wrap for the current version", async () => {
    expect((await recover([[2], [1, 2], [2]])).result).toEqual({ status: "complete" });
  });

  test("does not count wraps for an older history key version", async () => {
    expect((await recover([[1], [1], [1]])).result).toEqual({ status: "none" });
  });

  test("reports none when the newest epoch has no wrap for the current version", async () => {
    expect((await recover([[2], [2], []])).result).toEqual({ status: "none" });
  });

  test("reports protection from the oldest epoch in the newest unbroken run", async () => {
    expect((await recover([[2], [], [2], [2]])).result).toEqual({
      protectedFrom: createdAt(3),
      status: "partial",
    });
  });

  test("pages until the first unprotected epoch", async () => {
    const complete = await recover([[2], [2], [2], [2], [2]], 2);
    expect(complete.result).toEqual({ status: "complete" });
    expect(complete.listEpochs.mock.calls).toEqual([[null], [4], [2]]);

    const partial = await recover([[2], [], [2], [2], [2]], 2);
    expect(partial.result).toEqual({ protectedFrom: createdAt(3), status: "partial" });
    expect(partial.listEpochs.mock.calls).toEqual([[null], [4]]);
  });
});
