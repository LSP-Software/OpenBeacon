import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  createDeviceKeyPair,
  createHistoryKeyPair,
  DEVICE_KEY_ALGORITHM,
  type HistoryPrivateKeyMaterial,
  unwrapEpochKey,
  unwrapHistoryEpochKey,
  type WrappedEpochKey,
  type WrappedHistoryEpochKey,
} from "@openbeacon/encryption";
import { HISTORY_RECIPIENT_MISMATCH_MESSAGE } from "@openbeacon/schemas";
import { TRPCClientError } from "@trpc/client";

const deviceAKeyPair = createDeviceKeyPair();
const deviceBKeyPair = createDeviceKeyPair();
const historyAKeyPair = createHistoryKeyPair();
const historyBKeyPair = createHistoryKeyPair();
const historyB2KeyPair = createHistoryKeyPair();
const historyRecipientA = {
  historyKeyId: "history-a",
  publicKey: historyAKeyPair.publicKey,
  userId: "user-a",
  version: 1,
};
let historyRecipientB = {
  historyKeyId: "history-b",
  publicKey: historyBKeyPair.publicKey,
  userId: "user-b",
  version: 1,
};

const ensureDeviceKeyRegistrationMock = mock(async () => ({
  algorithm: DEVICE_KEY_ALGORITHM,
  deviceId: "device-a",
  privateKey: deviceAKeyPair.privateKey,
  publicKey: deviceAKeyPair.publicKey,
}));

const deviceKeyContextQueryMock = mock(async () => ({
  recipients: [
    {
      algorithm: DEVICE_KEY_ALGORITHM,
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      deviceId: "device-a",
      publicKey: deviceAKeyPair.publicKey,
      revokedAt: null,
      userId: "user-a",
    },
    {
      algorithm: DEVICE_KEY_ALGORITHM,
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      deviceId: "device-b",
      publicKey: deviceBKeyPair.publicKey,
      revokedAt: null,
      userId: "user-a",
    },
  ],
  historyRecipients: [historyRecipientA],
  userId: "user-a",
}));

const sharedAcceptanceContextMock = mock(async (_input: { code: string }) => ({
  groupId: "group-a",
  latestEpoch: {
    epochId: "previous",
    epochNumber: 1,
    groupId: "group-a",
    createdByDeviceId: "device-b",
    createdAt: new Date("2026-03-26T12:00:00.000Z"),
  },
  historyRecipients: [historyRecipientA, historyRecipientB],
  recipients: (await deviceKeyContextQueryMock()).recipients,
}));

const rotationContextMock = mock(
  async (_input: {
    groupId: string;
  }): Promise<Awaited<ReturnType<typeof sharedAcceptanceContextMock>> | null> =>
    sharedAcceptanceContextMock({ code: "" }),
);
const rotateMock = mock(async (_input: unknown) => ({ rotated: true }));

mock.module("./api.ts", () => ({
  queryClient: {
    setQueryData: () => {},
  },
  trpc: {
    maps: {
      forceRefreshSignedPmtilesUrl: {
        mutationOptions: () => ({}),
      },
      getSignedPmtilesUrl: {
        queryKey: () => [["maps", "getSignedPmtilesUrl"]],
        queryOptions: () => ({}),
      },
    },
  },
  trpcClient: {
    groupEpoch: {
      rotationContext: { query: rotationContextMock },
      rotate: { mutate: rotateMock },
    },
    groupInvites: { sharedAcceptanceContext: { mutate: sharedAcceptanceContextMock } },
    auth: {
      deviceKeyContext: {
        query: deviceKeyContextQueryMock,
      },
    },
  },
}));

mock.module("./deviceKeys.ts", () => ({
  ensureDeviceKeyRegistration: ensureDeviceKeyRegistrationMock,
}));

const badRequest = (message = HISTORY_RECIPIENT_MISMATCH_MESSAGE) =>
  TRPCClientError.from({ error: { code: -32600, data: { code: "BAD_REQUEST" }, message } });

const unwrapHistoryWrap = ({
  historyKeys,
  historyPrivateKey,
  userId,
  version = 1,
}: {
  historyKeys: WrappedHistoryEpochKey[];
  historyPrivateKey: HistoryPrivateKeyMaterial;
  userId: string;
  version?: number;
}) => {
  const wrap = historyKeys.find((historyKey) => historyKey.userId === userId);
  if (!wrap) throw new Error("Missing history wrap");
  return unwrapHistoryEpochKey({
    epochId: wrap.epochId,
    historyKeyVersion: version,
    historyPrivateKey,
    userId,
    wrappedEpochKey: wrap,
  }).expose();
};

const unwrapDeviceAWrap = (recipientKeys: WrappedEpochKey[]) =>
  unwrapEpochKey({
    recipientDeviceId: "device-a",
    recipientPrivateKey: deviceAKeyPair.privateKey,
    wrappedEpochKey: recipientKeys.find((key) => key.recipientDeviceId === "device-a")!,
  }).expose();

type RotateInput = {
  nextEpoch: { historyKeys: WrappedHistoryEpochKey[]; recipientKeys: WrappedEpochKey[] };
};

const importGroupEncryptionModule = async () =>
  import(`./groupEncryption.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./groupEncryption.ts")
  >;

describe("group encryption helpers", () => {
  beforeEach(() => {
    ensureDeviceKeyRegistrationMock.mockClear();
    deviceKeyContextQueryMock.mockClear();
    rotationContextMock.mockClear();
    rotateMock.mockClear();
    historyRecipientB = {
      historyKeyId: "history-b",
      publicKey: historyBKeyPair.publicKey,
      userId: "user-b",
      version: 1,
    };
  });

  test("wraps the initial epoch for all of the creator's active devices", async () => {
    const { buildCreateGroupInput } = await importGroupEncryptionModule();

    const result = await buildCreateGroupInput({
      name: "Family",
    });

    expect(result.initialEpoch.createdByDeviceId).toBe("device-a");
    expect(
      result.initialEpoch.recipientKeys.map((recipientKey) => recipientKey.recipientDeviceId),
    ).toEqual(["device-a", "device-b"]);
    const wrappedKeyForDeviceA = result.initialEpoch.recipientKeys.find(
      (recipientKey) => recipientKey.recipientDeviceId === "device-a",
    );
    const wrappedKeyForDeviceB = result.initialEpoch.recipientKeys.find(
      (recipientKey) => recipientKey.recipientDeviceId === "device-b",
    );

    if (!wrappedKeyForDeviceA || !wrappedKeyForDeviceB) {
      throw new Error("Missing wrapped key");
    }

    expect(
      unwrapEpochKey({
        recipientDeviceId: "device-a",
        recipientPrivateKey: deviceAKeyPair.privateKey,
        wrappedEpochKey: wrappedKeyForDeviceA,
      }).expose(),
    ).toEqual(
      unwrapEpochKey({
        recipientDeviceId: "device-b",
        recipientPrivateKey: deviceBKeyPair.privateKey,
        wrappedEpochKey: wrappedKeyForDeviceB,
      }).expose(),
    );
    expect(ensureDeviceKeyRegistrationMock).toHaveBeenCalledTimes(1);
    expect(deviceKeyContextQueryMock).toHaveBeenCalledTimes(1);
  });
  test("rotates a flagged group for every current recipient", async () => {
    const { rotateGroupEpochIfRequired } = await importGroupEncryptionModule();
    await rotateGroupEpochIfRequired("group-a");
    expect(rotationContextMock).toHaveBeenCalledWith({ groupId: "group-a" });
    const input = rotateMock.mock.calls[0]?.[0] as {
      groupId: string;
      nextEpoch: { epochNumber: number; recipientKeys: Array<{ recipientDeviceId: string }> };
    };
    expect(input.groupId).toBe("group-a");
    expect(input.nextEpoch.epochNumber).toBe(2);
    expect(input.nextEpoch.recipientKeys.map((key) => key.recipientDeviceId)).toEqual([
      "device-a",
      "device-b",
    ]);
  });
  test("reports no rotation and skips the mutation when the group doesn't need one", async () => {
    rotationContextMock.mockImplementationOnce(async () => null);
    const { rotateGroupEpochIfRequired } = await importGroupEncryptionModule();

    await expect(rotateGroupEpochIfRequired("group-a")).resolves.toBe(false);
    expect(rotateMock).not.toHaveBeenCalled();
  });

  test("reports no rotation when another member rotated first", async () => {
    rotateMock.mockImplementationOnce(async () => ({ rotated: false }));
    const { rotateGroupEpochIfRequired } = await importGroupEncryptionModule();

    await expect(rotateGroupEpochIfRequired("group-a")).resolves.toBe(false);
    expect(rotateMock).toHaveBeenCalledTimes(1);
  });

  test("retries a failed automatic rotation using the normal recipient keys", async () => {
    rotateMock.mockImplementationOnce(async () => {
      throw new Error("Network unavailable");
    });
    const { rotateGroupEpochIfRequired } = await importGroupEncryptionModule();
    await expect(rotateGroupEpochIfRequired("group-a")).rejects.toThrow("Network unavailable");
    await expect(rotateGroupEpochIfRequired("group-a")).resolves.toBe(true);
    expect(rotationContextMock).toHaveBeenCalledTimes(2);
    const input = rotateMock.mock.calls[1]?.[0] as {
      nextEpoch: { recipientKeys: Array<Parameters<typeof unwrapEpochKey>[0]["wrappedEpochKey"]> };
    };
    const first = input.nextEpoch.recipientKeys.find((key) => key.recipientDeviceId === "device-a");
    const second = input.nextEpoch.recipientKeys.find(
      (key) => key.recipientDeviceId === "device-b",
    );
    if (!first || !second) throw new Error("Missing wrapped key");
    expect(
      unwrapEpochKey({
        recipientDeviceId: "device-a",
        recipientPrivateKey: deviceAKeyPair.privateKey,
        wrappedEpochKey: first,
      }).expose(),
    ).toEqual(
      unwrapEpochKey({
        recipientDeviceId: "device-b",
        recipientPrivateKey: deviceBKeyPair.privateKey,
        wrappedEpochKey: second,
      }).expose(),
    );
  });
  test("builds the next shared-invitation epoch for every recipient", async () => {
    const { buildAcceptSharedInviteInput } = await importGroupEncryptionModule();
    const code = "A".repeat(32);
    const result = await buildAcceptSharedInviteInput({ code });
    expect(sharedAcceptanceContextMock).toHaveBeenCalledWith({ code });
    expect(result.code).toBe(code);
    expect(result.nextEpoch.epochNumber).toBe(2);
    expect(result.nextEpoch.recipientKeys.map((key) => key.recipientDeviceId)).toEqual([
      "device-a",
      "device-b",
    ]);
    const [first, second] = result.nextEpoch.recipientKeys;
    expect(
      unwrapEpochKey({
        recipientDeviceId: "device-a",
        recipientPrivateKey: deviceAKeyPair.privateKey,
        wrappedEpochKey: first!,
      }).expose(),
    ).toEqual(
      unwrapEpochKey({
        recipientDeviceId: "device-b",
        recipientPrivateKey: deviceBKeyPair.privateKey,
        wrappedEpochKey: second!,
      }).expose(),
    );
  });
  test("wraps a new group's first epoch to the creator's current history key", async () => {
    const { buildCreateGroupInput } = await importGroupEncryptionModule();
    const result = await buildCreateGroupInput({ name: "Family" });
    expect(result.initialEpoch.historyKeys).toHaveLength(1);
    expect(result.initialEpoch.historyKeys[0]).toMatchObject({
      epochId: result.initialEpoch.epochId,
      historyKeyVersion: 1,
      senderPublicKey: deviceAKeyPair.publicKey,
      userId: "user-a",
    });
    expect(
      unwrapHistoryWrap({
        historyKeys: result.initialEpoch.historyKeys,
        historyPrivateKey: historyAKeyPair.privateKey,
        userId: "user-a",
      }),
    ).toEqual(unwrapDeviceAWrap(result.initialEpoch.recipientKeys));
  });
  test("wraps a joined epoch to every history recipient in the context", async () => {
    const { buildAcceptSharedInviteInput } = await importGroupEncryptionModule();
    const { nextEpoch } = await buildAcceptSharedInviteInput({ code: "A".repeat(32) });
    expect(nextEpoch.historyKeys.map(({ userId }) => userId)).toEqual(["user-a", "user-b"]);
    const epochKey = unwrapDeviceAWrap(nextEpoch.recipientKeys);
    expect(
      unwrapHistoryWrap({
        historyKeys: nextEpoch.historyKeys,
        historyPrivateKey: historyAKeyPair.privateKey,
        userId: "user-a",
      }),
    ).toEqual(epochKey);
    expect(
      unwrapHistoryWrap({
        historyKeys: nextEpoch.historyKeys,
        historyPrivateKey: historyBKeyPair.privateKey,
        userId: "user-b",
      }),
    ).toEqual(epochKey);
  });
  test("rebuilds the epoch from a fresh context and retries once on a history recipient mismatch", async () => {
    rotateMock.mockImplementationOnce(async () => {
      historyRecipientB = {
        historyKeyId: "history-b-2",
        publicKey: historyB2KeyPair.publicKey,
        userId: "user-b",
        version: 2,
      };
      throw badRequest();
    });
    const { rotateGroupEpochIfRequired } = await importGroupEncryptionModule();
    await rotateGroupEpochIfRequired("group-a");
    expect(rotationContextMock).toHaveBeenCalledTimes(2);
    expect(rotateMock).toHaveBeenCalledTimes(2);
    const first = rotateMock.mock.calls[0]?.[0] as RotateInput;
    const retry = rotateMock.mock.calls[1]?.[0] as RotateInput;
    expect(first.nextEpoch.historyKeys.map((key) => key.historyKeyVersion)).toEqual([1, 1]);
    expect(retry.nextEpoch.historyKeys.map((key) => key.historyKeyVersion)).toEqual([1, 2]);
    expect(
      unwrapHistoryWrap({
        historyKeys: retry.nextEpoch.historyKeys,
        historyPrivateKey: historyB2KeyPair.privateKey,
        userId: "user-b",
        version: 2,
      }),
    ).toEqual(unwrapDeviceAWrap(retry.nextEpoch.recipientKeys));
  });
  test("gives up after one retry and doesn't retry other errors", async () => {
    const { submitEpochChange } = await importGroupEncryptionModule();
    const build = mock(async () => "input");
    const mismatch = mock(async (_input: string) => {
      throw badRequest();
    });
    await expect(submitEpochChange({ build, submit: mismatch })).rejects.toThrow(
      HISTORY_RECIPIENT_MISMATCH_MESSAGE,
    );
    expect(build).toHaveBeenCalledTimes(2);
    expect(mismatch).toHaveBeenCalledTimes(2);

    build.mockClear();
    const deviceMismatch = mock(async (_input: string) => {
      throw badRequest("Epoch recipient set does not match the active group devices.");
    });
    await expect(submitEpochChange({ build, submit: deviceMismatch })).rejects.toThrow(
      "Epoch recipient set does not match the active group devices.",
    );
    expect(build).toHaveBeenCalledTimes(1);
    expect(deviceMismatch).toHaveBeenCalledTimes(1);

    const plainError = mock(async (_input: string) => {
      throw new Error(HISTORY_RECIPIENT_MISMATCH_MESSAGE);
    });
    await expect(submitEpochChange({ build, submit: plainError })).rejects.toThrow();
    expect(plainError).toHaveBeenCalledTimes(1);
  });
});
