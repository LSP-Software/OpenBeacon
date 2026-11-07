import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  createInitialGroupEpoch,
  DEVICE_KEY_ALGORITHM,
  encodeBase64,
  unwrapEpochKey,
  WRAPPED_EPOCH_KEY_ALGORITHM,
} from "@openbeacon/encryption";
import {
  groupEpochBundleSchema,
  registerDeviceKeySchema,
  wrappedEpochKeySchema,
} from "./registerDeviceKey.ts";

describe("registerDeviceKeySchema", () => {
  test("accepts a valid X25519 public key and trims surrounding whitespace", () => {
    const deviceKeyPair = createDeviceKeyPair();
    const publicKey = ` ${deviceKeyPair.publicKey} `;

    expect(
      registerDeviceKeySchema.parse({
        algorithm: deviceKeyPair.algorithm,
        deviceId: "device-a",
        publicKey,
      }),
    ).toEqual({
      algorithm: deviceKeyPair.algorithm,
      deviceId: "device-a",
      publicKey: publicKey.trim(),
    });
  });

  test("rejects malformed base64", () => {
    expect(() =>
      registerDeviceKeySchema.parse({
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: "not-base64!",
      }),
    ).toThrow("Invalid device public key.");
  });

  test("rejects decoded keys with the wrong length", () => {
    expect(() =>
      registerDeviceKeySchema.parse({
        algorithm: DEVICE_KEY_ALGORITHM,
        deviceId: "device-a",
        publicKey: encodeBase64(new Uint8Array([1, 2, 3])),
      }),
    ).toThrow("Invalid device public key.");
  });

  test("rejects low-order device public keys", () => {
    for (const value of [0, 1]) {
      const bytes = new Uint8Array(32);
      bytes[0] = value;
      expect(
        registerDeviceKeySchema.safeParse({
          algorithm: DEVICE_KEY_ALGORITHM,
          deviceId: "device-a",
          publicKey: encodeBase64(bytes),
        }).success,
      ).toBe(false);
    }
  });

  test("rejects internal whitespace and oversized device keys", () => {
    const key = createDeviceKeyPair().publicKey;
    for (const publicKey of [
      `${key.slice(0, 4)}\n${key.slice(4)}`,
      `${key.slice(0, 4)}${" ".repeat(1_000_000)}${key.slice(4)}`,
    ]) {
      expect(
        registerDeviceKeySchema.safeParse({
          algorithm: DEVICE_KEY_ALGORITHM,
          deviceId: "device-a",
          publicKey,
        }).success,
      ).toBe(false);
    }
  });

  test("limits device identifiers", () => {
    const input = { algorithm: DEVICE_KEY_ALGORITHM, publicKey: createDeviceKeyPair().publicKey };
    expect(registerDeviceKeySchema.safeParse({ ...input, deviceId: "d".repeat(128) }).success).toBe(
      true,
    );
    expect(registerDeviceKeySchema.safeParse({ ...input, deviceId: "d".repeat(129) }).success).toBe(
      false,
    );
  });
});

describe("groupEpochBundleSchema", () => {
  test("validates encoded wrapped key components", () => {
    const device = createDeviceKeyPair();
    const epoch = createInitialGroupEpoch({
      creator: { deviceId: "device-a", privateKey: device.privateKey },
      groupId: "group-a",
      recipients: [
        {
          algorithm: DEVICE_KEY_ALGORITHM,
          createdAt: new Date(),
          deviceId: "device-a",
          publicKey: device.publicKey,
          revokedAt: null,
          userId: "user-a",
        },
      ],
    });
    const recipientKey = epoch.wrappedKeys[0]!;
    expect(wrappedEpochKeySchema.safeParse(recipientKey).success).toBe(true);
    expect(
      unwrapEpochKey({
        recipientDeviceId: "device-a",
        recipientPrivateKey: device.privateKey,
        wrappedEpochKey: wrappedEpochKeySchema.parse(recipientKey),
      }).expose(),
    ).toEqual(epoch.epochKey.expose());
    for (const field of ["ephemeralPublicKey", "senderPublicKey", "wrappedKey"] as const) {
      expect(
        wrappedEpochKeySchema.safeParse({ ...recipientKey, [field]: "invalid!" }).success,
      ).toBe(false);
      expect(
        wrappedEpochKeySchema.safeParse({
          ...recipientKey,
          [field]: encodeBase64(new Uint8Array(1)),
        }).success,
      ).toBe(false);
    }
  });

  test("rejects recipient keys whose epochId does not match the bundle epochId", () => {
    const recipientKey = wrappedEpochKeySchema.parse({
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      createdAt: new Date("2026-03-30T12:00:00.000Z"),
      ephemeralPublicKey: createDeviceKeyPair().publicKey,
      epochId: "epoch-2",
      recipientDeviceId: "device-b",
      senderPublicKey: createDeviceKeyPair().publicKey,
      wrappedKey: encodeBase64(new Uint8Array(48)),
    });

    const result = groupEpochBundleSchema.safeParse({
      createdByDeviceId: "device-a",
      epochId: "epoch-1",
      epochNumber: 1,
      recipientKeys: [recipientKey],
    });

    expect(result.success).toBe(false);

    if (result.success) {
      return;
    }

    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["recipientKeys", 0, "epochId"],
      }),
    );
  });

  test("rejects oversized epoch identifiers in both the bundle and recipient key", () => {
    const recipientKey = {
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      createdAt: new Date(),
      ephemeralPublicKey: createDeviceKeyPair().publicKey,
      epochId: "e".repeat(129),
      recipientDeviceId: "device-a",
      senderPublicKey: createDeviceKeyPair().publicKey,
      wrappedKey: encodeBase64(new Uint8Array(48)),
    };
    expect(
      wrappedEpochKeySchema.safeParse({ ...recipientKey, epochId: "e".repeat(128) }).success,
    ).toBe(true);
    expect(wrappedEpochKeySchema.safeParse(recipientKey).success).toBe(false);
    expect(
      groupEpochBundleSchema.safeParse({
        createdByDeviceId: "device-a",
        epochId: recipientKey.epochId,
        epochNumber: 1,
        recipientKeys: [recipientKey],
      }).success,
    ).toBe(false);
  });
});
