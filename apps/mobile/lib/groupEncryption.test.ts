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

mock.module("./api.ts", () => ({
  trpcClient: {
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
});
