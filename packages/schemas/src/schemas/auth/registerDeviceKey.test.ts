import { describe, expect, test } from "bun:test";
import {
  createDeviceKeyPair,
  DEVICE_KEY_ALGORITHM,
  encodeBase64,
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
    const publicKey = ` ${deviceKeyPair.publicKey.slice(0, 8)}\n${deviceKeyPair.publicKey.slice(8)} `;

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
});

describe("groupEpochBundleSchema", () => {
  test("validates encoded wrapped key components", () => {
    const recipientKey = {
      algorithm: WRAPPED_EPOCH_KEY_ALGORITHM,
      createdAt: new Date(),
      ephemeralPublicKey: encodeBase64(new Uint8Array(32)),
      epochId: "epoch-1",
      nonce: encodeBase64(new Uint8Array(24)),
      recipientDeviceId: "device-a",
      wrappedKey: encodeBase64(new Uint8Array(48)),
    };
    expect(wrappedEpochKeySchema.safeParse(recipientKey).success).toBe(true);
    for (const field of ["ephemeralPublicKey", "nonce", "wrappedKey"] as const) {
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
      ephemeralPublicKey: encodeBase64(new Uint8Array(32)),
      epochId: "epoch-2",
      nonce: encodeBase64(new Uint8Array(24)),
      recipientDeviceId: "device-b",
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
});
