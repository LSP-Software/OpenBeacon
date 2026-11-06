import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createDeviceKeyPair, DEVICE_KEY_ALGORITHM, unwrapEpochKey } from "@openbeacon/encryption";

const deviceAKeyPair = createDeviceKeyPair();
const deviceBKeyPair = createDeviceKeyPair();

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
  recipients: (await deviceKeyContextQueryMock()).recipients,
}));

const rotationContextMock = mock(async (_input: { groupId: string }) =>
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
  test("retries a failed automatic rotation using the normal recipient keys", async () => {
    rotateMock.mockImplementationOnce(async () => {
      throw new Error("Network unavailable");
    });
    const { rotateGroupEpochIfRequired } = await importGroupEncryptionModule();
    await expect(rotateGroupEpochIfRequired("group-a")).rejects.toThrow("Network unavailable");
    await expect(rotateGroupEpochIfRequired("group-a")).resolves.toBeUndefined();
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
});
